import { createHmac } from "node:crypto";
import { addMinutes } from "date-fns";
import { clock, fmtRange, fmtDayShort } from "@/lib/time";
import { EngineIndex, UPCOMING_STATUSES, computeStanding, describeSession, findSession, hasJoined, ladderStepFor, peopleLimits, playersOf, strikesFor } from "@/domain/engine";
import { resolvePolicy } from "@/domain/policy";
import type { AppNotification, AuditLog, Booking, Facility, NotificationType, Permission, RoleKey, RosterEntry, User, WaitlistEntry } from "@/domain/types";
import { ApiError, type BookingView, type CancelInfo, type PublicUser, type SessionUser } from "@/api/types";
import { db } from "./db";
import { DEMO } from "./state";
import { L, N, currentLanguage, withLanguage } from "@/i18n/lang";
import { facilityName, localFacility } from "@/domain/localize";
import { ctx, requestContext } from "../context";
import { config } from "../config";
import { queuePush } from "../push";

/* ─────────────────────────── Sessions & RBAC ─────────────────────────── */

export function permissionsFor(role: RoleKey): Permission[] {
  return db.state.roles.find((r) => r.key === role)?.permissions ?? [];
}

export function toSessionUser(u: User): SessionUser {
  return { ...u, permissions: permissionsFor(u.role), mustChangePassword: !!db.state.credentials.find((c) => c.id === u.id)?.temporary };
}

/**
 * The signed-in user for this request. The HTTP layer has already checked the
 * session cookie, idle timeout and (for students) the bound device.
 */
export function currentUser(): User {
  const c = ctx();
  if (!c.userId) throw new ApiError("UNAUTHENTICATED", "Please sign in to continue.");
  const u = db.state.users.find((x) => x.id === c.userId);
  // A suspended student keeps read-only access; everyone else suspended, and every closed account, is out.
  if (!u || u.status === "deactivated" || (u.status === "suspended" && u.role !== "student")) throw new ApiError("UNAUTHENTICATED", "Your account can’t be used right now. Please contact Student Affairs.");
  return u;
}

/**
 * New bookings, waitlist places and invitations need an account in good
 * standing. A suspended student can still see, cancel and leave bookings.
 */
export function requireActiveAccount(u: User) {
  if (u.status === "active") return;
  const why = u.statusNote?.reason;
  throw new ApiError("FORBIDDEN", L(`Your account is suspended${why ? ` (${why})` : ""}. You can still see and cancel your bookings — contact the facilities office to book again.`, `حسابك موقوف${why ? ` (${why})` : ""}. يمكنك رؤية حجوزاتك وإلغاؤها — تواصل مع مكتب إدارة المرافق لتتمكن من الحجز مرة أخرى.`));
}

export function requirePermission(perm: Permission): User {
  const u = currentUser();
  if (!permissionsFor(u.role).includes(perm)) {
    throw new ApiError("FORBIDDEN", "You don’t have permission to do that. If you think you should, contact a system administrator.");
  }
  return u;
}

export function hasPermission(u: User, perm: Permission) {
  return permissionsFor(u.role).includes(perm);
}

/* ─────────────────────────── Engine access ─────────────────────────── */

let rosterFor: { rows: RosterEntry[]; index: ReadonlyMap<string, RosterEntry> | null; idCheck: boolean } | null = null;
function rosterCache() {
  const rows = db.state.roster;
  if (rosterFor?.rows !== rows) rosterFor = { rows, index: rows.length ? new Map(rows.map((r) => [r.id, r])) : null, idCheck: rows.some((r) => r.idCheck) };
  return rosterFor;
}
/** The official list by university ID, or null when no list is loaded. Rebuilt only when the list changes. */
export const rosterIndex = (): ReadonlyMap<string, RosterEntry> | null => rosterCache().index;
/** The list carries national-ID digits, so registration asks for them. */
export const rosterUsesIdCheck = () => rosterCache().idCheck;

/** Keyed hash of a student's national-ID digits, bound to their university ID. */
export function nationalIdCheck(universityId: string, lastFour: string): string {
  return createHmac("sha256", config.rosterSecret).update(`nid:${universityId}:${lastFour}`).digest("base64url");
}

export function engine(now = clock.now()): EngineIndex {
  const s = db.state;
  return new EngineIndex({
    now,
    globalPolicy: s.globalPolicy,
    weekStartsOn: s.settings.weekStartsOn,
    facilities: s.facilities,
    categories: s.categories,
    bookings: s.bookings,
    waitlist: s.waitlist,
    maintenance: s.maintenance,
    restrictions: s.restrictions,
    users: s.users,
    roster: rosterIndex(),
  });
}

export function facilityOrThrow(id: string): Facility {
  const f = db.state.facilities.find((x) => x.id === id);
  if (!f) throw new ApiError("NOT_FOUND", "We couldn’t find that facility. It may have been removed.");
  return f;
}

export function bookingOrThrow(id: string): Booking {
  const b = db.state.bookings.find((x) => x.id === id);
  if (!b) throw new ApiError("NOT_FOUND", "We couldn’t find that booking.");
  return b;
}

export function policyFor(f: Facility) {
  return resolvePolicy(db.state.globalPolicy, db.state.categories.find((c) => c.id === f.categoryId), f);
}

/* ─────────────────────────── DTO mapping ─────────────────────────── */

/** Another student's university ID as students see it: enough to tell people apart, not enough to register as them. */
export const maskedId = (id: string | undefined) => (id ? `•••${id.slice(-3)}` : undefined);

export function toPublic(u: User | undefined, withId = true): PublicUser {
  if (!u) return { id: "unknown", name: "Former student", avatarHue: 0, role: "student" };
  return { id: u.id, name: u.name, avatarHue: u.avatarHue, role: u.role, universityId: withId ? u.universityId : undefined, faculty: u.faculty, year: u.year };
}

export function unitName(f: Facility, index: number): string | null {
  if (f.mode !== "exclusive" || f.units <= 1) return null;
  const label = currentLanguage() === "ar" && f.ar?.unitLabel ? f.ar.unitLabel : f.unitLabel.charAt(0).toUpperCase() + f.unitLabel.slice(1);
  return `${label} ${index + 1}`;
}

export function cancelInfo(b: Booking, f: Facility, now = clock.now()): CancelInfo {
  const p = policyFor(f);
  const start = new Date(b.start);
  const freeUntil = addMinutes(start, -p.cancellation.freeUntilMinutes);
  const allowed = UPCOMING_STATUSES.has(b.status) && start > now;
  const late = allowed && now > freeUntil && b.status === "CONFIRMED";
  return {
    allowed,
    late,
    penalty: late && p.cancellation.lateCountsAsStrike,
    freeUntil: freeUntil.toISOString(),
    reason: allowed ? undefined : start <= now ? L("This session has already started.", "بدأ هذا الموعد بالفعل.") : L("This booking can no longer be cancelled.", "لم يعد من الممكن إلغاء هذا الحجز."),
  };
}

export function toView(b: Booking, viewerId?: string): BookingView {
  const s = db.state;
  const f = s.facilities.find((x) => x.id === b.facilityId)!;
  const cat = s.categories.find((c) => c.id === f.categoryId)!;
  const users = new Map(s.users.map((u) => [u.id, u]));
  const p = policyFor(f);
  const start = new Date(b.start);
  const mine = b.participants.find((x) => x.userId === viewerId);
  // Students see other students' university IDs masked; staff and administrators see them in full.
  const viewer = viewerId ? users.get(viewerId) : undefined;
  const person = (u: User | undefined): PublicUser => {
    const p = toPublic(u);
    return viewer?.role === "student" && u && u.id !== viewer.id ? { ...p, universityId: maskedId(p.universityId) } : p;
  };
  return {
    ...b,
    facility: f,
    category: cat,
    booker: person(users.get(b.userId)),
    people: b.participants.filter(hasJoined).map((x) => person(users.get(x.userId))),
    team: b.participants.map((x) => ({ user: person(users.get(x.userId)), status: x.status ?? "accepted" })),
    playersNeeded: b.status === "AWAITING_PLAYERS" ? Math.max(0, peopleLimits(f, p).min - playersOf(b).length) : 0,
    peopleLimits: peopleLimits(f, p),
    unitName: unitName(f, b.unitIndex),
    relation: viewerId === b.userId ? "booker" : mine && hasJoined(mine) ? "participant" : mine?.status === "invited" ? "invited" : "staff",
    cancel: cancelInfo(b, f),
    checkInWindow: { opens: addMinutes(start, -p.checkIn.opensMinutesBefore).toISOString(), closes: addMinutes(start, p.checkIn.graceMinutes).toISOString() },
  };
}

/* ─────────────────────────── Side effects ─────────────────────────── */

/** Notification text is written in the recipient's language — pass functions so dates and names follow it too. */
export type NotifyText = string | (() => string);

export function notify(userId: string, type: NotificationType, title: NotifyText, body: NotifyText, extra: Partial<AppNotification> = {}) {
  const lang = db.state.users.find((u) => u.id === userId)?.preferences?.language ?? "en";
  const [t, b] = withLanguage(lang, () => [typeof title === "function" ? title() : title, typeof body === "function" ? body() : body]);
  const n: AppNotification = { id: `N-${db.nextSeq()}`, userId, type, title: t, body: b, createdAt: clock.now().toISOString(), ...extra };
  db.put("notifications", n);
  queuePush(n);
  return n;
}

export function audit(actor: User | "system", action: string, entityType: AuditLog["entityType"], entityId: string, entityLabel: string, summary: string) {
  const a: AuditLog = {
    id: `AU-${60000 + db.nextSeq()}`,
    at: clock.now().toISOString(),
    actorId: actor === "system" ? "system" : actor.id,
    actorName: actor === "system" ? "System" : actor.name,
    actorRole: actor === "system" ? "system" : actor.role,
    action,
    entityType,
    entityId,
    entityLabel,
    summary,
    ip: actor === "system" ? "—" : (requestContext.getStore()?.ip ?? "—"),
  };
  db.put("audit", a);
}

export function updateBooking(b: Booking, patch: Partial<Booking>): Booking {
  const next: Booking = { ...b, ...patch, updatedAt: clock.now().toISOString(), version: b.version + 1 };
  db.put("bookings", next);
  return next;
}

const sessionLabel = (b: { start: string; end: string }) => `${fmtDayShort(b.start)}${L(", ", "، ")}${fmtRange(b.start, b.end)}`;

/**
 * A space opened up — offer it to the next student in the queue.
 * The spot is held for them for the policy's claim window.
 */
export function offerNext(facilityId: string, start: string): WaitlistEntry | undefined {
  const f = db.state.facilities.find((x) => x.id === facilityId);
  if (!f) return;
  const p = policyFor(f);
  if (!p.waitlist.enabled) return;
  const now = clock.now();
  if (new Date(start) <= addMinutes(now, p.window.minLeadMinutes)) return;
  const slot = findSession(f, start);
  if (!slot) return;
  const ix = engine(now);
  const info = describeSession(ix, f, slot.start, slot.end);
  if (info.remaining <= 0) return;
  // Someone who couldn't claim the spot (a suspended or closed account) is passed over, not held for.
  const canClaim = (userId: string) => db.state.users.find((u) => u.id === userId)?.status === "active";
  const queue = db.state.waitlist.filter((w) => w.facilityId === facilityId && w.start === start && w.status === "waiting" && canClaim(w.userId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const next = queue[0];
  if (!next) return;
  // Never hold a spot past the moment booking closes for the session — it couldn't be claimed then.
  const closes = addMinutes(new Date(start), -p.window.minLeadMinutes);
  const expires = new Date(Math.min(addMinutes(now, p.waitlist.claimMinutes).getTime(), closes.getTime()));
  const holdMinutes = Math.max(1, Math.floor((expires.getTime() - now.getTime()) / 60000));
  const offered: WaitlistEntry = { ...next, status: "offered", offeredAt: now.toISOString(), offerExpiresAt: expires.toISOString() };
  db.put("waitlist", offered);
  notify(
    next.userId,
    "slot_available",
    () => L(`A spot opened on ${f.name}`, `توفر مكان في ${facilityName(f)}`),
    () => L(`${sessionLabel(next)}. It’s held for you for ${holdMinutes} ${holdMinutes === 1 ? "minute" : "minutes"} — claim it before it moves to the next student.`, `${sessionLabel(next)}. المكان محجوز لك لمدة ${N.minute(holdMinutes)} — احجزه قبل أن ينتقل للطالب التالي.`),
    {
    link: "/bookings?tab=waitlist",
    data: { waitlistId: next.id, facilityId, expiresAt: offered.offerExpiresAt },
  });
  audit("system", "waitlist.offer", "waitlist", next.id, f.name, `Offered a freed spot (${withLanguage("en", () => sessionLabel(next))}) to position #1, held until ${expires.toTimeString().slice(0, 5)}`);
  return offered;
}

/** Apply the no-show ladder after a new strike. */
export function applyLadder(userId: string, actor: User | "system") {
  const ix = engine();
  const policy = db.state.globalPolicy;
  const { active } = strikesFor(ix.involvements(userId), userId, policy, ix.now);
  const step = ladderStepFor(policy, active.length);
  const u = db.state.users.find((x) => x.id === userId);
  if (!step || !u) return;
  if (step.action === "restrict" && !ix.activeRestriction(userId) && active.length === step.strikes) {
    const now = clock.now();
    const end = addMinutes(now, (step.restrictDays ?? 14) * 1440);
    const r = { id: `RS-${3000 + db.nextSeq()}`, userId, reason: `${active.length} missed sessions in ${policy.noShow.strikeExpiryDays} days`, source: "auto" as const, start: now.toISOString(), end: end.toISOString(), createdBy: "system" as const };
    db.put("restrictions", r);
    notify(
      userId,
      "restriction",
      () => L(`Booking paused for ${step.restrictDays ?? 14} days`, `تم إيقاف الحجز لمدة ${N.day(step.restrictDays ?? 14)}`),
      () => L(`You’ve missed ${active.length} sessions. New bookings are paused until ${fmtDayShort(end.toISOString())}. Existing bookings still stand — please attend or cancel them.`, `فاتك ${N.session(active.length)}. الحجز الجديد متوقف حتى ${fmtDayShort(end.toISOString())}. حجوزاتك الحالية قائمة — من فضلك احضرها أو ألغِها.`),
      { link: "/profile" },
    );
    audit(actor, "restriction.create", "restriction", r.id, u.name, `Booking paused for ${step.restrictDays} days — reached ${active.length} missed sessions`);
  } else if (step.action !== "restrict") {
    const remaining = (policy.noShow.ladder.find((s) => s.action === "restrict")?.strikes ?? 3) - active.length;
    notify(
      userId,
      "noshow_warning",
      () => (step.action === "final_warning" ? L("Final warning: missed session", "إنذار أخير: موعد فائت") : L("Missed session recorded", "تم تسجيل موعد فائت")),
      () =>
        L(
          `You now have ${active.length} missed ${active.length === 1 ? "session" : "sessions"}. ${remaining > 0 ? `${remaining} more and booking is paused.` : ""} Strikes expire after ${policy.noShow.strikeExpiryDays} days.`,
          `أصبح لديك ${N.strike(active.length)}. ${remaining > 0 ? `بعد ${N.strike(remaining)} أخرى يتوقف الحجز.` : ""} تنتهي المخالفات بعد ${N.day(policy.noShow.strikeExpiryDays)}.`,
        ),
      { link: "/profile" },
    );
  }
}

/**
 * After a strike is waived: an automatic pause exists only because of the
 * strike count, so if the student is now below the ladder's pause step it
 * ends too. Pauses an administrator set by hand stay as they are.
 */
export function liftAutoRestrictionIfCleared(userId: string, actor: User) {
  const ix = engine();
  const r = ix.activeRestriction(userId);
  if (!r || r.source !== "auto") return;
  const policy = db.state.globalPolicy;
  const pauseAt = policy.noShow.ladder.find((s) => s.action === "restrict")?.strikes;
  const { active } = strikesFor(ix.involvements(userId), userId, policy, ix.now);
  if (pauseAt === undefined || active.length >= pauseAt) return;
  db.put("restrictions", { ...r, lifted: { at: clock.now().toISOString(), byUserId: actor.id, reason: "A strike was waived" } });
  const u = db.state.users.find((x) => x.id === userId);
  notify(userId, "restriction", () => L("You can book again", "يمكنك الحجز مرة أخرى"), () => L("A missed session was forgiven, so your automatic booking pause has been lifted.", "تم إلغاء مخالفة غياب، لذلك رُفع إيقاف الحجز التلقائي عنك."), { link: "/explore" });
  audit(actor, "restriction.lift", "restriction", r.id, u?.name ?? userId, "Lifted the automatic pause — a strike was waived and the student is below the limit again");
}

/* ─────────────────────────── Scheduler ─────────────────────────── */

/** Stable pseudo-random fate for simulated students (0–1). */
function fate(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

let lastTick = 0;
let ticking = false;

/**
 * Time-based transitions — the job a real backend runs every minute:
 * reminders, auto no-shows, completions, pending expiry and waitlist offers.
 * Other (simulated) students "arrive" shortly before the grace period ends,
 * which keeps the campus alive without taking work away from staff demos.
 */
export async function tick(force = false) {
  const nowMs = clock.now().getTime();
  if (ticking || (!force && nowMs - lastTick < 20000)) return;
  ticking = true;
  lastTick = nowMs;
  try {
    const now = clock.now();
    const s = db.state;
    const anchor = db.anchorDate.getTime();
    const needs =
      s.bookings.some((b) => {
        const st = new Date(b.start).getTime();
        const en = new Date(b.end).getTime();
        if (b.status === "CHECKED_IN") return en <= nowMs;
        if (b.status === "PENDING") return st <= nowMs;
        if (b.status === "AWAITING_PLAYERS") return st <= nowMs || (!!b.playersDeadline && new Date(b.playersDeadline).getTime() <= nowMs);
        if (b.status === "CONFIRMED") return st <= nowMs + 3 * 3600000;
        return false;
      }) || s.waitlist.some((w) => w.status === "offered" && w.offerExpiresAt && new Date(w.offerExpiresAt).getTime() <= nowMs);
    if (!needs) return;

    await db.transaction(() => {
      const st = db.state;
      // Demo data: only people who have signed in get reminders and strikes; the rest are simulated.
      const demoData = db.isDemo;
      const activeUsers = demoData ? new Set<string>([DEMO.student, ...st.users.filter((u) => u.lastActiveAt).map((u) => u.id)]) : null;
      const isActive = (id: string) => !activeUsers || activeUsers.has(id);
      const reopen: { facilityId: string; start: string }[] = [];

      for (const w of st.waitlist) {
        if (w.status === "offered" && w.offerExpiresAt && new Date(w.offerExpiresAt) <= now) {
          db.put("waitlist", { ...w, status: "expired" });
          const f = st.facilities.find((x) => x.id === w.facilityId);
          notify(
            w.userId,
            "waitlist_expired",
            () => L("Waitlist offer expired", "انتهى عرض قائمة الانتظار"),
            () => L(`The spot on ${f?.name ?? "the facility"} (${sessionLabel(w)}) wasn’t claimed in time and has moved to the next student.`, `لم يتم حجز المكان في ${f ? facilityName(f) : "المرفق"} (${sessionLabel(w)}) في الوقت المحدد، وانتقل للطالب التالي.`),
            { link: "/bookings?tab=waitlist" },
          );
          reopen.push({ facilityId: w.facilityId, start: w.start });
        }
      }

      for (const b of st.bookings) {
        const start = new Date(b.start).getTime();
        const end = new Date(b.end).getTime();
        const f = st.facilities.find((x) => x.id === b.facilityId);
        if (!f) continue;
        const p = policyFor(f);
        const graceEnd = start + p.checkIn.graceMinutes * 60000;
        const simulated = demoData && new Date(b.createdAt).getTime() <= anchor && b.userId !== DEMO.student;

        if (b.status === "AWAITING_PLAYERS") {
          if (start <= nowMs || (b.playersDeadline && new Date(b.playersDeadline).getTime() <= nowMs)) {
            cancelShortOfPlayers(b, f);
            reopen.push({ facilityId: b.facilityId, start: b.start });
          }
          continue;
        }
        if (b.status === "PENDING" && start <= nowMs) {
          updateBooking(b, { status: "EXPIRED", expiredAt: now.toISOString() });
          notify(
            b.userId,
            "booking_rejected",
            () => L(`${f.name} request expired`, `انتهى طلب ${facilityName(f)}`),
            () => L(`Your request for ${sessionLabel(b)} wasn’t reviewed before the session started, so it has expired. No strike has been recorded.`, `لم تتم مراجعة طلبك لموعد ${sessionLabel(b)} قبل بدايته، لذلك انتهى. لم تُسجّل عليك مخالفة.`),
          );
          continue;
        }
        if (b.status === "CHECKED_IN" && end <= nowMs) {
          updateBooking(b, { status: "COMPLETED" });
          continue;
        }
        if (b.status !== "CONFIRMED") continue;

        if (simulated && nowMs >= graceEnd - 60000 && nowMs < end && fate(b.id) < 0.94) {
          const at = new Date(Math.min(nowMs, graceEnd - 60000 - fate(b.id + "t") * 20 * 60000));
          updateBooking(b, { status: "CHECKED_IN", checkIn: { at: at.toISOString(), byUserId: st.users.find((u) => u.assignedFacilityIds?.includes(f.id))?.id ?? DEMO.staff, method: "qr" } });
          continue;
        }
        if (simulated && nowMs >= end && fate(b.id) < 0.94) {
          updateBooking(b, { status: "COMPLETED", checkIn: { at: new Date(start - 5 * 60000).toISOString(), byUserId: DEMO.staff, method: "qr" } });
          continue;
        }
        if (p.checkIn.autoNoShow && nowMs >= graceEnd) {
          updateBooking(b, { status: "NO_SHOW", noShow: { at: new Date(graceEnd).toISOString(), byUserId: "system", auto: true } });
          audit("system", "booking.no_show", "booking", b.id, b.id, `Marked as no-show at ${f.name} — grace period ended without check-in`);
          if (isActive(b.userId)) applyLadder(b.userId, "system");
          continue;
        }
        const u = st.users.find((x) => x.id === b.userId);
        const remind = u?.preferences?.reminderMinutes ?? st.settings.reminderMinutesBefore;
        if (!b.reminderSentAt && isActive(b.userId) && start > nowMs && start - nowMs <= remind * 60000) {
          updateBooking(b, { reminderSentAt: now.toISOString() });
          const mins = Math.round((start - nowMs) / 60000);
          // Everyone playing gets the reminder, not just the booker.
          for (const who of playersOf(b)) notify(
            who,
            "booking_reminder",
            () => L(`${f.name} starts in ${mins} min`, `${facilityName(f)} يبدأ بعد ${N.minute(mins)}`),
            () => {
              const lf = localFacility(f);
              return L(
                `${sessionLabel(b)} · ${f.location.building}${f.location.area ? `, ${f.location.area}` : ""}. Have your QR code ready — check-in closes ${p.checkIn.graceMinutes} min after the start.`,
                `${sessionLabel(b)} · ${lf.location.building}${lf.location.area ? `، ${lf.location.area}` : ""}. جهّز كود QR — تسجيل الحضور يُغلق بعد ${N.minute(p.checkIn.graceMinutes)} من البداية.`,
              );
            },
            { link: `/bookings/${b.id}`, data: { bookingId: b.id } },
          );
        }
      }
      for (const r of reopen) offerNext(r.facilityId, r.start);
    });
  } finally {
    ticking = false;
  }
}

/** Too few invited players accepted in time: cancel without a strike and free the session for others. */
export function cancelShortOfPlayers(b: Booking, f: Facility) {
  updateBooking(b, { status: "CANCELLED", playersDeadline: undefined, cancellation: { at: clock.now().toISOString(), byUserId: "system", reason: "Not enough players accepted in time", late: false, penalty: false, byRole: "system" } });
  for (const id of playersOf(b)) {
    notify(
      id,
      "booking_cancelled",
      () => L(`${f.name} booking cancelled`, `تم إلغاء حجز ${facilityName(f)}`),
      () => L(`Not enough players accepted in time for ${sessionLabel(b)}, so the session was released for other students. No strike has been recorded.`, `لم يوافق عدد كافٍ من اللاعبين في الوقت المحدد لموعد ${sessionLabel(b)}، لذلك أُتيح الموعد لطلاب آخرين. لم تُسجّل عليك مخالفة.`),
      { link: `/bookings/${b.id}`, data: { bookingId: b.id } },
    );
  }
  audit("system", "booking.cancel", "booking", b.id, b.id, `Cancelled ${f.name}, ${withLanguage("en", () => sessionLabel(b))} — not enough players accepted in time`);
}

export function standingFor(userId: string) {
  return computeStanding(engine(), userId);
}
