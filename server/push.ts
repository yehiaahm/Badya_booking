import { createHash } from "node:crypto";
import webpush from "web-push";
import { clock } from "@/lib/time";
import type { AppNotification, PushSubscriptionRecord } from "@/domain/types";
import { ApiError } from "@/api/types";
import { L } from "@/i18n/lang";
import { config } from "./config";
import { db } from "./api/db";

/**
 * Notifications on the phone itself (Web Push), like any other app's.
 *
 * Every in-app notification is also pushed to the recipient's phones once the
 * database write is committed. A subscription belongs to a user *and* a
 * device: when a student's account moves to another phone, the old phone
 * stops receiving their notifications.
 */

const TTL_SECONDS = 12 * 3600;
/** A subscription that keeps failing is dropped; the phone re-subscribes the next time the app opens. */
const MAX_FAILURES = 5;

/**
 * The server posts to whatever address a browser hands it, so only the real
 * push services are accepted — never an address inside the university network.
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "updates.push.services.mozilla.com", "web.push.apple.com", ".push.apple.com", ".notify.windows.com"];
const extraHosts = new Set<string>();

export const pushId = (endpoint: string) => createHash("sha256").update(endpoint).digest("base64url");

function allowedEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (extraHosts.has(u.host)) return true;
  return u.protocol === "https:" && !u.username && !u.password && PUSH_HOSTS.some((h) => (h.startsWith(".") ? u.hostname.endsWith(h) : u.hostname === h));
}

/** Tests: accept a local push service and capture what would be sent. */
export function usePushServiceForTests(host: string, send?: typeof sender) {
  extraHosts.add(host);
  if (send) sender = send;
}

type Sender = (sub: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<unknown>;
let sender: Sender = (sub, payload, options) => webpush.sendNotification(sub, payload, options);

/** Push services require a contact for the sender: the public HTTPS address, or the support email. */
function vapidSubject(): string {
  if (config.publicUrl.startsWith("https://")) return config.publicUrl;
  return `mailto:${db.state.settings.supportEmail}`;
}

/** Students only get pushes on the phone their account is linked to. */
function stillTheirs(s: PushSubscriptionRecord): boolean {
  const u = db.state.users.find((x) => x.id === s.userId);
  if (!u || u.status !== "active") return false;
  if (u.role !== "student" || db.isDemo) return true;
  return db.state.devices.some((d) => d.id === s.deviceId && d.userId === s.userId);
}

/** What the service worker shows. Push services cap payloads at about 4 KB. */
interface PushPayload {
  title: string;
  body: string;
  link?: string;
  tag: string;
}

/** Called for every new notification: send it to the recipient's phones after the write commits. */
export function queuePush(n: AppNotification) {
  if (!db.state.pushSubscriptions.some((s) => s.userId === n.userId)) return;
  const payload: PushPayload = { title: n.title.slice(0, 200), body: n.body.slice(0, 1000), link: n.link, tag: n.data?.bookingId ?? n.type };
  db.afterCommit(() => void deliver(n.userId, payload));
}

async function deliver(userId: string, payload: PushPayload) {
  const subs = db.state.pushSubscriptions.filter((s) => s.userId === userId && stillTheirs(s));
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
          TTL: TTL_SECONDS,
          urgency: "high",
          vapidDetails: { subject: vapidSubject(), publicKey: config.vapid.publicKey, privateKey: config.vapid.privateKey },
        });
        if (s.failures) await db.transaction(() => update(s.id, { failures: 0, lastSentAt: clock.now().toISOString() }), { silent: true });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        const gone = status === 404 || status === 410;
        const failures = (s.failures ?? 0) + 1;
        if (!gone) console.warn(`[push] couldn't reach a phone (${status ?? (e as Error).message})`);
        await db.transaction(() => (gone || failures >= MAX_FAILURES ? remove(s.id) : update(s.id, { failures })), { silent: true });
      }
    }),
  );
}

function update(id: string, patch: Partial<PushSubscriptionRecord>) {
  const cur = db.state.pushSubscriptions.find((x) => x.id === id);
  if (cur) db.put("pushSubscriptions", { ...cur, ...patch });
}

function remove(id: string) {
  if (db.state.pushSubscriptions.some((x) => x.id === id)) db.remove("pushSubscriptions", id);
}

/** Forget subscriptions — e.g. the device was unlinked from the account. Call inside a transaction. */
export function dropPushSubscriptions(match: (s: PushSubscriptionRecord) => boolean) {
  for (const s of db.state.pushSubscriptions.filter(match)) db.remove("pushSubscriptions", s.id);
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** Save this browser's subscription for the signed-in user. Call inside a transaction. */
export function savePushSubscription(userId: string, deviceId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  if (!allowedEndpoint(sub.endpoint)) throw new ApiError("VALIDATION", L("This browser’s notification service isn’t supported. Try Chrome, Safari, Firefox or Edge.", "خدمة الإشعارات في هذا المتصفح غير مدعومة. جرّب Chrome أو Safari أو Firefox أو Edge."));
  if (!B64URL.test(sub.keys.p256dh) || !B64URL.test(sub.keys.auth)) throw new ApiError("VALIDATION", "Some of the information sent was invalid.");
  const id = pushId(sub.endpoint);
  // One browser, one account: this endpoint now belongs to whoever is signed in here.
  dropPushSubscriptions((s) => s.id !== id && s.userId === userId && s.deviceId === deviceId);
  const prev = db.state.pushSubscriptions.find((s) => s.id === id);
  db.put("pushSubscriptions", { id, userId, deviceId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, createdAt: prev?.userId === userId ? prev.createdAt : clock.now().toISOString() });
}
