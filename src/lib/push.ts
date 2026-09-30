import { useCallback, useEffect, useState } from "react";
import { api } from "@/api";

/**
 * Notifications on the phone (Web Push). The browser gives us a subscription
 * after the student allows notifications; the server sends every in-app
 * notification to it, and `public/sw.js` shows it — even when the app is closed.
 */

export type PushState =
  /** This browser can't receive push notifications at all. */
  | "unsupported"
  /** iPhone/iPad in Safari: push only works once the app is added to the Home Screen. */
  | "needs-install"
  /** Not asked yet. */
  | "off"
  /** Allowed and subscribed. */
  | "on"
  /** The student said no; only the browser's site settings can undo it. */
  | "blocked"
  | "checking";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installed = () => matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** On an iPhone in Safari (not added to the Home Screen) the app can't send notifications yet. */
export const needsHomeScreen = () => isIos() && !installed();

function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(new URL("sw.js", document.baseURI), { scope: "./" }).then(() => navigator.serviceWorker.ready);
}

const toKey = (b64url: string) => {
  const s = atob(b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "="));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function currentState(): Promise<PushState> {
  if (!supported()) return needsHomeScreen() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  const reg = await navigator.serviceWorker.getRegistration(new URL("./", document.baseURI).href);
  return (await reg?.pushManager.getSubscription()) ? "on" : "off";
}

/** Ask for permission (must follow a tap) and hand the subscription to the server. */
export async function enablePush(publicKey: string): Promise<PushState> {
  if (!supported()) return needsHomeScreen() ? "needs-install" : "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const reg = await registration();
  const key = toKey(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older server key can't receive messages any more.
  const old = sub?.options.applicationServerKey;
  if (sub && old && new Uint8Array(old).join() !== key.join()) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.me.subscribePush({ endpoint: json.endpoint, keys: json.keys });
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration(new URL("./", document.baseURI).href);
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
  await api.me.unsubscribePush();
  return "off";
}

/**
 * Where notifications stand on this phone. When they're already allowed, the
 * subscription is re-sent on open so it stays linked to the signed-in account.
 */
export function usePush(publicKey: string | undefined) {
  const [state, setState] = useState<PushState>("checking");
  useEffect(() => {
    let live = true;
    currentState()
      .then(async (s) => {
        if (s === "on" && publicKey) s = await enablePush(publicKey).catch(() => s);
        if (live) setState(s);
      })
      .catch(() => live && setState("unsupported"));
    return () => {
      live = false;
    };
  }, [publicKey]);
  const enable = useCallback(async () => {
    if (!publicKey) return;
    setState(await enablePush(publicKey));
  }, [publicKey]);
  const disable = useCallback(async () => setState(await disablePush()), []);
  return { state, enable, disable };
}
