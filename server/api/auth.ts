import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { addMinutes } from "date-fns";
import { clock } from "@/lib/time";
import { L } from "@/i18n/lang";
import type { AuthSession, Device, DeviceRequest, RosterEntry, User } from "@/domain/types";
import { ApiError, type SessionUser } from "@/api/types";
import { config } from "../config";
import { ctx } from "../context";
import { MIN_PASSWORD, hashPassword, temporaryPassword, verifyPassword } from "../password";
import { audit, currentUser, nationalIdCheck, notify, rosterIndex, rosterUsesIdCheck, toSessionUser } from "./core";
import { db } from "./db";
import { FACULTIES } from "./seed/catalog";
import { dropPushSubscriptions } from "../push";
import { westernDigits } from "@/lib/roster";

/* ─────────────────────────── Tokens ─────────────────────────── */

export const SESSION_COOKIE = "bs_session";
export const DEVICE_COOKIE = "bs_device";
/** Browsers cap cookies at about 400 days; the app renews them every time it opens. */
export const COOKIE_MAX_AGE = 400 * 86400;
export const newToken = () => randomBytes(32).toString("base64url");
/** Cookie tokens are stored hashed, so a leaked database can't be used to sign in. */
export const hashToken = (t: string) => createHash("sha256").update(t).digest("base64url");

/**
 * Wrong passwords before sign-in pauses, and for how long. The pause is per
 * account *and network*, so someone guessing can't lock the real owner (or an
 * administrator) out from elsewhere; a much higher account-wide limit stops
 * guessing spread over many networks.
 */
const LOCK_AFTER = 8;
const ACCOUNT_LOCK_AFTER = 40;
const LOCK_MINUTES = 15;
/** Requests one student may have waiting at once (each clears their cookies = a "new device"). */
const MAX_PENDING_REQUESTS = 3;
/** How long a student has to send their device request after proving the password. */
const TICKET_TTL_MINUTES = 30;

const normEmail = (e: string) => e.trim().toLowerCase();
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Proof that this device just entered the right password for an account that
 * is linked elsewhere — lets the student write to the facilities office
 * without sending the password again.
 */
function signTicket(userId: string, deviceId: string, kind: DeviceRequest["kind"]): string {
  const body = Buffer.from(JSON.stringify({ u: userId, d: deviceId, k: kind, x: addMinutes(clock.now(), TICKET_TTL_MINUTES).getTime() })).toString("base64url");
  return `${body}.${createHmac("sha256", config.sessionSecret).update(`dev:${body}`).digest("base64url")}`;
}
function readTicket(token: string): { userId: string; deviceId: string; kind: DeviceRequest["kind"] } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sig, createHmac("sha256", config.sessionSecret).update(`dev:${body}`).digest("base64url"))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { u: string; d: string; k: DeviceRequest["kind"]; x: number };
    return p.x > clock.now().getTime() ? { userId: p.u, deviceId: p.d, kind: p.k } : null;
  } catch {
    return null;
  }
}

/** "Chrome on Android", "Safari on iPhone"… */
export function deviceLabel(ua: string): string {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}

export function cookie(name: string, value: string, maxAgeSeconds: number | null): string {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (maxAgeSeconds !== null) parts.push(`Max-Age=${maxAgeSeconds}`);
  if (config.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

/* ─────────────────────────── Sessions ─────────────────────────── */

/**
 * Validate the session cookie for this request. Returns the user id, or null
 * (with `expired` when an idle session just timed out).
 */
export function resolveSession(tokenHash: string, deviceId: string | null): { userId: string | null; expired?: boolean } {
  const s = db.state.sessions.find((x) => x.id === tokenHash);
  // Several requests (live updates, background refreshes) can arrive after an idle timeout — all of them say why.
  if (!s || s.revokedAt) return { userId: null, expired: !!s?.idle };
  const u = db.state.users.find((x) => x.id === s.userId);
  // A suspended student keeps using the app read-only; closed accounts and suspended staff are signed out.
  if (!u || u.status === "deactivated" || (u.status === "suspended" && u.role !== "student")) return { userId: null };
  // A session only works on the device it was created on.
  if (!deviceId || s.deviceId !== deviceId) return { userId: null };
  // Students: the device must still be bound to them (an admin may have moved or reset it).
  if (u.role === "student" && !db.isDemo && !db.state.devices.some((d) => d.id === deviceId && d.userId === u.id)) return { userId: null };
  // Students stay signed in on their own device; staff and admins time out when idle.
  const now = clock.now();
  if (u.role !== "student" && now.getTime() - new Date(s.lastSeenAt).getTime() > db.state.settings.sessionTimeoutMinutes * 60000) {
    void db.transaction(() => db.put("sessions", { ...s, revokedAt: now.toISOString(), idle: true }), { silent: true });
    return { userId: null, expired: true };
  }
  if (now.getTime() - new Date(s.lastSeenAt).getTime() > 60000) {
    void db.transaction(() => {
      db.put("sessions", { ...s, lastSeenAt: now.toISOString() });
      const d = db.state.devices.find((x) => x.id === deviceId);
      if (d) db.put("devices", { ...d, lastSeenAt: now.toISOString() });
    }, { silent: true });
  }
  return { userId: u.id };
}

function revokeSessions(pred: (s: AuthSession) => boolean) {
  const at = clock.now().toISOString();
  for (const s of db.state.sessions) if (!s.revokedAt && pred(s)) db.put("sessions", { ...s, revokedAt: at });
}

function startSession(user: User): SignInResult {
  const c = ctx();
  const token = newToken();
  const now = clock.now().toISOString();
  db.put("sessions", { id: hashToken(token), userId: user.id, deviceId: c.deviceId!, createdAt: now, lastSeenAt: now });
  const u = { ...user, lastActiveAt: now };
  db.put("users", u);
  c.setCookies.push(cookie(SESSION_COOKIE, token, user.role === "student" ? COOKIE_MAX_AGE : null));
  // A stale cookie from an earlier session would otherwise be cleared after this one is set.
  c.clearSession = false;
  c.userId = u.id;
  audit(u, "session.sign_in", "session", u.id, u.name, "Signed in");
  return { status: "signed_in", user: toSessionUser(u) };
}

/* ─────────────────────────── Devices ─────────────────────────── */

export type SignInResult =
  | { status: "signed_in"; user: SessionUser }
  /** The password was right, but the account or this device belongs elsewhere: the student can write to the facilities office. */
  | { status: "device_locked"; kind: DeviceRequest["kind"]; ticket: string }
  /** A request from this device is already waiting. */
  | { status: "device_approval"; requestId: string; kind: DeviceRequest["kind"] };

function ensureDevice(): Device {
  const c = ctx();
  if (!c.deviceId) throw new ApiError("VALIDATION", "Your browser blocked the cookie this app needs. Allow cookies for this site and try again.");
  const existing = db.state.devices.find((d) => d.id === c.deviceId);
  if (existing) return existing;
  const now = clock.now().toISOString();
  const d: Device = { id: c.deviceId, label: deviceLabel(c.userAgent), userAgent: c.userAgent.slice(0, 300), createdAt: now, lastSeenAt: now };
  db.put("devices", d);
  return d;
}

/**
 * Sign a user in on this device — or, for a student whose account or device is
 * already linked elsewhere, stop and let them ask the facilities office.
 */
function establish(user: User): SignInResult {
  if (user.status === "deactivated") throw new ApiError("FORBIDDEN", "This account has been closed. Please contact the facilities office.");
  if (user.status === "suspended") throw new ApiError("FORBIDDEN", "This account is suspended. Please contact Student Affairs.");
  const device = ensureDevice();
  // Staff scan on shared devices, and demo data lets one presenter switch accounts.
  if (user.role !== "student" || db.isDemo) return startSession(user);
  if (device.userId === user.id) return startSession(user);

  const kind = deviceConflict(user, device);
  if (!kind) {
    db.put("devices", { ...device, userId: user.id, boundAt: clock.now().toISOString() });
    for (const x of db.state.deviceRequests) if (x.userId === user.id && x.status === "pending") db.put("deviceRequests", { ...x, status: "cancelled" });
    audit(user, "device.bind", "device", device.id.slice(0, 12), user.name, `Linked account to ${device.label}`);
    return startSession(user);
  }
  const pending = db.state.deviceRequests.find((r) => r.userId === user.id && r.deviceId === device.id && r.status === "pending");
  if (pending) return { status: "device_approval", requestId: pending.id, kind: pending.kind };
  return { status: "device_locked", kind, ticket: signTicket(user.id, device.id, kind) };
}

/** Why this student can't use this device on their own: someone else's device, or they're at their device limit. */
function deviceConflict(user: User, device: Device): DeviceRequest["kind"] | null {
  if (device.userId && device.userId !== user.id) return "device_in_use";
  const bound = db.state.devices.filter((d) => d.userId === user.id);
  return bound.length >= Math.max(1, db.state.settings.maxDevicesPerStudent) ? "new_device" : null;
}

/** The student's message to the facilities office, asking to use this device. */
function openDeviceRequest(user: User, device: Device, kind: DeviceRequest["kind"], message: string | undefined): DeviceRequest {
  const req: DeviceRequest = {
    id: `DR-${1000 + db.nextSeq()}`,
    userId: user.id,
    deviceId: device.id,
    deviceLabel: device.label,
    kind,
    otherUserId: kind === "device_in_use" ? device.userId : undefined,
    status: "pending",
    createdAt: clock.now().toISOString(),
    message,
  };
  db.put("deviceRequests", req);
  if (kind === "new_device") {
    notify(
      user.id,
      "device_request",
      () => L("Someone asked to use your account on another phone", "طلب لاستخدام حسابك على موبايل آخر"),
      () => L(`A request to move your account to ${device.label} was sent to the facilities office. If this wasn’t you, tell the office and change your password.`, `تم إرسال طلب لنقل حسابك إلى ${device.label} لمكتب إدارة المرافق. إن لم تكن أنت، أبلغ المكتب وغيّر كلمة المرور.`),
      { link: "/profile" },
    );
  }
  const other = req.otherUserId ? db.state.users.find((u) => u.id === req.otherUserId) : undefined;
  audit(user, "device.request", "device", req.id, user.name, kind === "device_in_use" ? `Asked to sign in on ${device.label}, which is linked to ${other?.name ?? "another student"}` : `Asked to sign in on a new device (${device.label})`);
  for (const a of db.state.users.filter((u) => (u.role === "admin" || u.role === "super_admin") && u.status === "active")) {
    notify(
      a.id,
      "device_request",
      () => L(`Device approval needed: ${user.name}`, `مطلوب موافقة على جهاز: ${user.name}`),
      () =>
        (kind === "device_in_use"
          ? L(`${user.name} wants to sign in on ${device.label}, which is linked to ${other?.name ?? "another student"}.`, `${user.name} يريد تسجيل الدخول من ${device.label}، وهو مربوط بـ${other?.name ?? "طالب آخر"}.`)
          : L(`${user.name} wants to sign in on a new device (${device.label}).`, `${user.name} يريد تسجيل الدخول من جهاز جديد (${device.label}).`)) + (message ? ` “${message}”` : ""),
      { link: "/admin/devices" },
    );
  }
  return req;
}

/** Admin: move a device to the requesting student, or turn the request down. */
export function decideDeviceRequest(actor: User, id: string, decision: "approved" | "rejected", note?: string) {
  const r = db.state.deviceRequests.find((x) => x.id === id);
  if (!r) throw new ApiError("NOT_FOUND", "Request not found.");
  if (r.status !== "pending") throw new ApiError("CONFLICT", "This request has already been handled.");
  const student = db.state.users.find((u) => u.id === r.userId);
  if (!student) throw new ApiError("NOT_FOUND", "Student not found.");
  const at = clock.now().toISOString();
  db.put("deviceRequests", { ...r, status: decision, decidedAt: at, decidedBy: actor.id, note: note || undefined });
  if (decision === "rejected") {
    audit(actor, "device.reject", "device", r.id, student.name, `Declined ${student.name}’s sign-in on ${r.deviceLabel}${note ? ` — ${note}` : ""}`);
    notify(
      student.id,
      "device_decision",
      () => L("Device request declined", "تم رفض طلب الجهاز"),
      () => L(`Your request to sign in on ${r.deviceLabel} was declined${note ? `: ${note}` : "."} Contact the facilities office if you think this is a mistake.`, `تم رفض طلبك لتسجيل الدخول من ${r.deviceLabel}${note ? `: ${note}` : "."} تواصل مع مكتب إدارة المرافق لو ترى أن هذا خطأ.`),
    );
    return;
  }
  const device = db.state.devices.find((d) => d.id === r.deviceId);
  if (!device) throw new ApiError("NOT_FOUND", "That device is no longer known to the system.");
  // Free the device from whoever held it.
  if (device.userId && device.userId !== student.id) {
    const prev = device.userId;
    revokeSessions((s) => s.userId === prev && s.deviceId === device.id);
    dropPushSubscriptions((s) => s.userId === prev && s.deviceId === device.id);
    notify(prev, "device_decision", () => L("A device was unlinked from your account", "تم فك ربط جهاز من حسابك"), () => L(`${device.label} is no longer linked to your account. Sign in on your own device.`, `${device.label} لم يعد مربوطًا بحسابك. سجّل الدخول من جهازك الخاص.`));
  }
  // Keep the student within their device allowance — the oldest link goes first.
  const max = Math.max(1, db.state.settings.maxDevicesPerStudent);
  const others = db.state.devices.filter((d) => d.userId === student.id && d.id !== device.id).sort((a, b) => (a.boundAt ?? a.createdAt).localeCompare(b.boundAt ?? b.createdAt));
  for (const old of others.slice(0, Math.max(0, others.length - (max - 1)))) {
    db.put("devices", { ...old, userId: undefined, boundAt: undefined });
    revokeSessions((s) => s.deviceId === old.id && s.userId === student.id);
    dropPushSubscriptions((s) => s.deviceId === old.id && s.userId === student.id);
  }
  db.put("devices", { ...db.state.devices.find((d) => d.id === device.id)!, userId: student.id, boundAt: at });
  // Anything else waiting on this device is now moot.
  for (const x of db.state.deviceRequests) if (x.id !== r.id && x.status === "pending" && x.deviceId === device.id && x.userId === student.id) db.put("deviceRequests", { ...x, status: "cancelled" });
  audit(actor, "device.approve", "device", r.id, student.name, `Linked ${student.name} to ${r.deviceLabel}${note ? ` — ${note}` : ""}`);
  notify(student.id, "device_decision", () => L("Device approved", "تمت الموافقة على الجهاز"), () => L(`You can now use Badya Spaces on ${r.deviceLabel}.`, `يمكنك الآن استخدام Badya Spaces من ${r.deviceLabel}.`));
}

/** A closed account: every session ends, its devices and phone notifications are released, device requests lapse. */
export function signOutEverywhere(userId: string) {
  for (const d of db.state.devices) if (d.userId === userId) db.put("devices", { ...d, userId: undefined, boundAt: undefined });
  revokeSessions((s) => s.userId === userId);
  dropPushSubscriptions((s) => s.userId === userId);
  for (const x of db.state.deviceRequests) if (x.userId === userId && x.status === "pending") db.put("deviceRequests", { ...x, status: "cancelled" });
}

/** Admin: unlink every device from a student. Their next sign-in links the device they use. */
export function resetDevices(actor: User, userId: string, reason: string) {
  const student = db.state.users.find((u) => u.id === userId && u.role === "student");
  if (!student) throw new ApiError("NOT_FOUND", "Student not found.");
  const linked = db.state.devices.filter((d) => d.userId === userId);
  signOutEverywhere(userId);
  audit(actor, "device.reset", "device", userId, student.name, `Unlinked ${linked.length} ${linked.length === 1 ? "device" : "devices"} — ${reason}`);
  notify(student.id, "device_decision", () => L("Your devices were reset", "تمت إعادة ضبط أجهزتك"), () => L(`The facilities office unlinked your devices (${reason}). The next device you sign in on becomes your linked device.`, `فك مكتب إدارة المرافق ربط أجهزتك (${reason}). أول جهاز تسجّل الدخول منه سيصبح جهازك المربوط.`));
}

/* ─────────────────────────── Public API ─────────────────────────── */

const hits = new Map<string, number[]>();
/**
 * Per-network limits, one bucket per action. Campus Wi-Fi puts many students
 * behind one address, so these are generous — they stop scripts, not people.
 */
function limit(action: string, max: number, windowMs: number) {
  const now = Date.now();
  const key = `${action}|${ctx().ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) throw new ApiError("RATE_LIMITED", "Too many attempts from this network. Please wait a few minutes and try again.");
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 20_000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k);
}

/** Wrong-password streaks per account+network: `${userId}|${ip}`. Kept in memory — a restart simply forgets them. */
const streaks = new Map<string, { n: number; until?: number }>();

const COMMON_PASSWORDS = new Set(["12345678", "123456789", "1234567890", "password", "password1", "qwertyui", "qwerty123", "11111111", "00000000", "abcd1234", "badya123", "badya2026", "badyauniversity", "iloveyou"]);

/** Reject passwords that are too short or too easy to guess from what others know about the student. */
function checkPassword(p: string, known: (string | undefined)[] = []) {
  if (p.length < MIN_PASSWORD) throw new ApiError("VALIDATION", L(`Use a password of at least ${MIN_PASSWORD} characters.`, `استخدم كلمة مرور من ${MIN_PASSWORD} أحرف على الأقل.`));
  if (p.length > 200) throw new ApiError("VALIDATION", "That password is too long.");
  const lower = p.toLowerCase();
  const guessable =
    COMMON_PASSWORDS.has(lower) ||
    /^(.)\1+$/.test(p) ||
    "01234567890123456789".includes(p) ||
    known.filter((k): k is string => !!k && k.length >= 4).some((k) => lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower));
  if (guessable) throw new ApiError("VALIDATION", "That password is too easy to guess. Don’t use your university ID, your email or a simple sequence.");
}

/** Wrong national-ID digits per university ID (timestamps). Kept in memory — a restart simply forgets them. */
const idCheckFailures = new Map<string, number[]>();
const ID_CHECK_TRIES = 5;
/** Five wrong tries pause the ID for a day: guessing four digits would take months. */
const ID_CHECK_WINDOW = 24 * 3600_000;

/** A newly loaded list may have corrected someone's digits — everyone paused gets a fresh start. */
export function clearRegistrationLocks() {
  idCheckFailures.clear();
}

/**
 * Registration is open only to university IDs on the official student list.
 * Returns the student's entry — its details become the account's.
 */
function checkAgainstList(universityId: string, email: string, lastFour: string | undefined): RosterEntry {
  const roster = rosterIndex();
  if (!roster) throw new ApiError("VALIDATION", L("Registration opens once the facilities office has loaded the official student list. Please try again later, or visit the office.", "يُفتح التسجيل بعد أن يرفع مكتب إدارة المرافق قائمة الطلاب الرسمية. حاول لاحقًا، أو توجّه للمكتب."));
  const listed = roster.get(universityId);
  if (!listed) throw new ApiError("VALIDATION", L("This university ID isn’t on the official student list. Check it against your student card, or visit the facilities office.", "هذا الرقم الجامعي غير موجود في قائمة الطلاب الرسمية. راجعه على الكارنيه، أو توجّه لمكتب إدارة المرافق."));
  if (listed.status === "inactive") throw new ApiError("VALIDATION", L("This university ID isn’t active on the official student list. If you’re a current student, visit the facilities office with your student card.", "هذا الرقم الجامعي غير نشط في قائمة الطلاب الرسمية. إذا كنت طالبًا حاليًا، توجّه لمكتب إدارة المرافق ومعك الكارنيه."));
  if (listed.email && listed.email !== email) throw new ApiError("VALIDATION", L("This email doesn’t match the university’s records for this ID. Use your own university email.", "هذا البريد لا يطابق سجلات الجامعة لهذا الرقم. استخدم بريدك الجامعي الخاص."));
  if (listed.idCheck) {
    const now = Date.now();
    const recent = (idCheckFailures.get(universityId) ?? []).filter((t) => now - t < ID_CHECK_WINDOW);
    if (recent.length >= ID_CHECK_TRIES) throw new ApiError("RATE_LIMITED", L("Too many wrong attempts for this university ID. Try again tomorrow — or, if you’re sure of your digits, visit the facilities office with your student card so they can check the student list.", "محاولات خاطئة كثيرة لهذا الرقم الجامعي. حاول غدًا — وإذا كنت متأكدًا من أرقامك، توجّه لمكتب إدارة المرافق ومعك الكارنيه لمراجعة قائمة الطلاب."));
    const digits = westernDigits(lastFour ?? "").replace(/\s/g, "");
    if (!/^\d{4}$/.test(digits)) throw new ApiError("VALIDATION", L("Enter the last 4 digits of your national ID.", "اكتب آخر 4 أرقام من رقمك القومي."));
    if (!safeEqual(nationalIdCheck(universityId, digits), listed.idCheck)) {
      recent.push(now);
      idCheckFailures.set(universityId, recent);
      if (recent.length === ID_CHECK_TRIES) void db.transaction(() => audit("system", "user.register_locked", "user", universityId, universityId, `Registration with university ID ${universityId} paused for a day after ${ID_CHECK_TRIES} wrong national-ID digits`));
      throw new ApiError("VALIDATION", L("The last 4 digits of your national ID don’t match the university’s records.", "آخر 4 أرقام من الرقم القومي لا تطابق سجلات الجامعة."));
    }
    idCheckFailures.delete(universityId);
  }
  return listed;
}

/** Admin: give someone a new temporary password (to hand over in person). */
export async function setTemporaryPassword(actor: User, user: User): Promise<string> {
  const password = temporaryPassword();
  const hash = await hashPassword(password);
  await db.transaction(() => {
    db.put("credentials", { id: user.id, hash, updatedAt: clock.now().toISOString(), temporary: true });
    // Staff and admins are signed out; a student keeps their own phone signed in.
    if (user.role !== "student") {
      revokeSessions((s) => s.userId === user.id);
      dropPushSubscriptions((s) => s.userId === user.id);
    }
    audit(actor, "user.password_reset", "user", user.id, user.name, `Set a new temporary password for ${user.name}`);
  });
  return password;
}

/** One-tap demo accounts: only with demo data, and never on a production server unless ALLOW_DEMO_SIGN_IN is set. */
const demoSignInAllowed = () => db.isDemo && (!config.production || config.allowDemoSignIn);

export function domainAllowed(email: string) {
  const domain = email.split("@")[1] ?? "";
  return db.state.settings.allowedEmailDomains.some((d) => domain === d);
}

export const auth = {
  /** What the sign-in screen needs before anyone is signed in. */
  config() {
    const s = db.state.settings;
    return {
      productName: s.productName,
      universityName: s.universityName,
      supportEmail: s.supportEmail,
      allowedEmailDomains: s.allowedEmailDomains,
      faculties: FACULTIES,
      /** Registration only accepts university IDs on the uploaded official list — with none loaded, it's closed. */
      studentList: !!rosterIndex(),
      /** Registration asks for the last 4 digits of the national ID. */
      idCheck: rosterUsesIdCheck(),
      /** Public half of the key that signs push notifications. */
      pushPublicKey: config.vapid.publicKey,
      demo: demoSignInAllowed(),
      demoAccounts: demoSignInAllowed()
        ? [
            { role: "student" as const, email: "student@badya.edu.eg", name: "Yehia Ahmed" },
            { role: "staff" as const, email: "staff@badya.edu.eg", name: "Karim Mostafa" },
            { role: "admin" as const, email: "admin@badya.edu.eg", name: "Nour El-Din Samir" },
            { role: "super_admin" as const, email: "superadmin@badya.edu.eg", name: "Tamer Helmy" },
          ]
        : [],
    };
  },

  /** Sign in with a university ID or email and a password. */
  async signIn(rawIdentifier: string, password: string): Promise<SignInResult> {
    const id = westernDigits(rawIdentifier).trim().toLowerCase();
    if (!id || !password) throw new ApiError("VALIDATION", "Enter your university ID or email and your password.");
    limit("signin", 2000, 3600_000);
    // A closed account keeps its email and ID for history; a newer account with them wins.
    const matches = db.state.users.filter((u) => u.email.toLowerCase() === id || (!!u.universityId && u.universityId === id));
    const user = matches.find((u) => u.status !== "deactivated") ?? matches[0];
    const cred = user ? db.state.credentials.find((c) => c.id === user.id) : undefined;
    const now = clock.now().getTime();
    const streakKey = user ? `${user.id}|${ctx().ip}` : "";
    const streak = streaks.get(streakKey);
    const lockedUntil = Math.max(streak?.until ?? 0, cred?.lockedUntil ? new Date(cred.lockedUntil).getTime() : 0);
    if (lockedUntil > now) {
      const mins = Math.ceil((lockedUntil - now) / 60000);
      throw new ApiError("RATE_LIMITED", L(`Too many wrong passwords. Try again in ${mins} min, or ask the facilities office to reset it.`, `كلمات مرور خاطئة كثيرة. حاول بعد ${mins} دقيقة، أو اطلب من مكتب إدارة المرافق إعادة تعيينها.`));
    }
    const ok = await verifyPassword(password, cred?.hash);
    if (!user || !cred || !ok) {
      if (user && cred) {
        const n = (streak?.n ?? 0) + 1;
        const pairLocked = n >= LOCK_AFTER;
        streaks.set(streakKey, pairLocked ? { n: 0, until: now + LOCK_MINUTES * 60000 } : { n });
        const failures = (cred.failures ?? 0) + 1;
        const accountLocked = failures >= ACCOUNT_LOCK_AFTER;
        await db.transaction(() => {
          db.put("credentials", { ...cred, failures: accountLocked ? 0 : failures, lockedUntil: accountLocked ? addMinutes(clock.now(), LOCK_MINUTES).toISOString() : cred.lockedUntil });
          if (pairLocked || accountLocked) audit(user, "session.locked", "session", user.id, user.name, accountLocked ? `Sign-in paused for ${LOCK_MINUTES} min after ${ACCOUNT_LOCK_AFTER} wrong passwords from several networks` : `Sign-in paused for ${LOCK_MINUTES} min after ${LOCK_AFTER} wrong passwords from one network`);
        }, { silent: !(pairLocked || accountLocked) });
      }
      throw new ApiError("VALIDATION", "That university ID, email or password isn’t right.");
    }
    streaks.delete(streakKey);
    return db.transaction(() => {
      if (cred.failures || cred.lockedUntil) db.put("credentials", { ...cred, failures: 0, lockedUntil: undefined });
      return establish(user);
    });
  },

  /**
   * A new student creates their account — it's linked to this device straight away.
   * Only university IDs on the official student list can register, and the
   * list's details (name, faculty, year) win over what was typed. Where the
   * list has national-ID digits, they prove the ID is the student's own.
   */
  async register(p: { name: string; nameAr?: string; email: string; universityId: string; faculty: string; year: number; level: "undergraduate" | "postgraduate"; password: string; nationalIdLast4?: string }): Promise<SignInResult> {
    const email = normEmail(p.email);
    const universityId = westernDigits(p.universityId).trim();
    const name = p.name.trim().replace(/\s+/g, " ");
    // Letters, spaces, dots, hyphens and apostrophes only — names end up in exports and messages.
    if (name.split(" ").length < 2 || name.length < 5 || !/^\p{L}[\p{L}\p{M} .'’-]*$/u.test(name) || (p.nameAr && !/^[\p{L}\p{M} .'’-]*$/u.test(p.nameAr.trim()))) {
      throw new ApiError("VALIDATION", "Enter your full name as it appears on your student ID.");
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError("VALIDATION", "Enter your university email address.");
    if (!domainAllowed(email)) throw new ApiError("VALIDATION", L(`Use your university email (${db.state.settings.allowedEmailDomains.map((d) => "@" + d).join(" or ")}).`, `استخدم بريدك الجامعي (${db.state.settings.allowedEmailDomains.map((d) => "@" + d).join(" أو ")}).`));
    if (!/^\d+$/.test(universityId)) throw new ApiError("VALIDATION", "Your university ID should be digits only.");
    if (!/^\d{5,12}$/.test(universityId)) throw new ApiError("VALIDATION", "Your university ID should be 5 to 12 digits.");
    if (!FACULTIES.includes(p.faculty)) throw new ApiError("VALIDATION", "Choose your faculty from the list.");
    checkPassword(p.password, [universityId, email, email.split("@")[0]]);
    limit("register", 1000, 3600_000);
    const checked = checkAgainstList(universityId, email, p.nationalIdLast4);
    const hash = await hashPassword(p.password);
    return db.transaction(() => {
      // The list may have been replaced while the password was hashed: check against the one in force now.
      const listed = rosterIndex()?.get(universityId) === checked ? checked : checkAgainstList(universityId, email, p.nationalIdLast4);
      // Closed accounts keep their details for history but don't hold them.
      const live = db.state.users.filter((u) => u.status !== "deactivated");
      if (live.some((u) => u.email.toLowerCase() === email)) throw new ApiError("CONFLICT", "An account already uses this email. Sign in instead — or, if it isn’t yours, contact the facilities office.");
      if (live.some((u) => u.universityId === universityId)) throw new ApiError("CONFLICT", "An account already uses this university ID. If it’s yours, contact the facilities office.");
      const now = clock.now().toISOString();
      const u: User = {
        id: `u_${randomBytes(6).toString("hex")}`,
        role: "student",
        name: listed.name ?? name,
        nameAr: listed.nameAr ?? (p.nameAr?.trim() || undefined),
        email,
        avatarHue: randomInt(0, 360),
        status: "active",
        createdAt: now,
        universityId,
        faculty: listed.faculty ?? p.faculty,
        year: listed.year ?? p.year,
        audience: listed.level ?? p.level,
        preferences: { reminderMinutes: db.state.settings.reminderMinutesBefore, waitlistAlerts: true, emailDigest: false, language: ctx().language },
      };
      db.put("users", u);
      db.put("credentials", { id: u.id, hash, updatedAt: now });
      audit(u, "user.register", "user", u.id, u.name, `Registered as a student (${u.faculty}, year ${u.year})`);
      return establish(u);
    });
  },

  /** After a "device locked" sign-in: send the facilities office a message asking to use this device. */
  async contactAdmin(ticket: string, message?: string): Promise<SignInResult> {
    const t = readTicket(ticket);
    if (!t || t.deviceId !== ctx().deviceId) throw new ApiError("VALIDATION", "This page has expired. Sign in again to send your request.");
    limit("contact", 300, 3600_000);
    return db.transaction(() => {
      const user = db.state.users.find((u) => u.id === t.userId);
      if (!user) throw new ApiError("NOT_FOUND", "Student not found.");
      const device = ensureDevice();
      // Something may have changed since (an admin reset their devices): sign in if nothing blocks it now.
      const kind = deviceConflict(user, device);
      if (!kind || user.role !== "student") return establish(user);
      const pending = db.state.deviceRequests.find((r) => r.userId === user.id && r.deviceId === device.id && r.status === "pending");
      if (!pending && db.state.deviceRequests.filter((r) => r.userId === user.id && r.status === "pending").length >= MAX_PENDING_REQUESTS) {
        throw new ApiError("RATE_LIMITED", "You already have requests waiting. The facilities office will review them — or visit the office with your student card.");
      }
      const req = pending ?? openDeviceRequest(user, device, kind, message?.trim() || undefined);
      return { status: "device_approval", requestId: req.id, kind: req.kind } as SignInResult;
    });
  },

  /** Signed in: change your own password. */
  async changePassword(current: string, next: string) {
    const u = currentUser();
    checkPassword(next, [u.universityId, u.email, u.email.split("@")[0]]);
    limit("password", 60, 3600_000);
    const cred = db.state.credentials.find((c) => c.id === u.id);
    if (cred && !(await verifyPassword(current, cred.hash))) throw new ApiError("VALIDATION", "Your current password isn’t right.");
    const hash = await hashPassword(next);
    await db.transaction(() => {
      db.put("credentials", { id: u.id, hash, updatedAt: clock.now().toISOString(), temporary: false });
      // Sign out everywhere else.
      const here = ctx().sessionId;
      const device = ctx().deviceId;
      revokeSessions((s) => s.userId === u.id && s.id !== here);
      dropPushSubscriptions((s) => s.userId === u.id && s.deviceId !== device);
      audit(u, "user.password", "user", u.id, u.name, "Changed their password");
    });
  },

  /** A student waiting for device approval polls this from the same device. */
  async deviceRequestStatus(requestId: string): Promise<{ status: "pending" | "rejected" | "cancelled"; note?: string } | SignInResult> {
    const r = db.state.deviceRequests.find((x) => x.id === requestId);
    if (!r || r.deviceId !== ctx().deviceId) throw new ApiError("NOT_FOUND", "Request not found.");
    if (r.status === "pending") return { status: "pending" };
    if (r.status === "rejected") return { status: "rejected", note: r.note };
    if (r.status === "cancelled") return { status: "cancelled" };
    const user = db.state.users.find((u) => u.id === r.userId)!;
    return db.transaction(() => establish(user));
  },

  async cancelDeviceRequest(requestId: string) {
    await db.transaction(() => {
      const r = db.state.deviceRequests.find((x) => x.id === requestId);
      if (!r || r.deviceId !== ctx().deviceId) throw new ApiError("NOT_FOUND", "Request not found.");
      if (r.status === "pending") db.put("deviceRequests", { ...r, status: "cancelled" });
    });
  },

  /** Demo data only: switch accounts without a password. */
  async demoSignIn(email: string): Promise<SignInResult> {
    if (!demoSignInAllowed()) throw new ApiError("FORBIDDEN", "Demo sign-in is only available with demo data.");
    const user = db.state.users.find((u) => u.email.toLowerCase() === normEmail(email));
    if (!user) throw new ApiError("NOT_FOUND", "No demo account with that email.");
    return db.transaction(() => establish(user));
  },

  async me(): Promise<SessionUser | null> {
    if (!ctx().userId) return null;
    return toSessionUser(currentUser());
  },

  async logout() {
    const c = ctx();
    c.clearSession = true;
    if (!c.sessionId) return;
    await db.transaction(() => {
      const s = db.state.sessions.find((x) => x.id === c.sessionId);
      if (s && !s.revokedAt) db.put("sessions", { ...s, revokedAt: clock.now().toISOString() });
      const u = s && db.state.users.find((x) => x.id === s.userId);
      if (u) {
        dropPushSubscriptions((x) => x.userId === u.id && x.deviceId === c.deviceId);
        audit(u, "session.sign_out", "session", u.id, u.name, "Signed out");
      }
    });
  },
};
