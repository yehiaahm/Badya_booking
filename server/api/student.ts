import { addDays, isSameDay, startOfDay, startOfWeek } from "date-fns";
import { clock, fmtDayShort, fmtRange, fmtTime, dayKey, fromDayKey } from "@/lib/time";
import { daySessions, evaluateBooking, evaluateJoin, hasJoined, nextAvailable, peopleLimits, playersDeadline, playersOf, sessionTimes, slotStatus, summarizeDay, takesBookings, USAGE_STATUSES, UPCOMING_STATUSES, type Evaluation } from "@/domain/engine";
import { describePolicy } from "@/domain/policy";
import { facilityName, localFacility } from "@/domain/localize";
import { L, N, withLanguage } from "@/i18n/lang";
import type { Booking, Facility, FairnessFlag, User, UserPreferences, WaitlistEntry } from "@/domain/types";
import {
  ApiError,
  type Availability,
  type BookingDetail,
  type BookingEvent,
  type BookingView,
  type CancelResult,
  type CreateBookingInput,
  type CreateBookingResult,
  type FacilityDetail,
  type FacilitySummary,
  type PublicUser,
  type StandingInfo,
  type WaitlistView,
} from "@/api/types";
import {
  applyLadder,
  audit,
  bookingOrThrow,
  cancelInfo,
  currentUser,
  engine,
  facilityOrThrow,
  notify,
  offerNext,
  policyFor,
  requireActiveAccount,
  maskedId,
  requirePermission,
  standingFor,
  tick,
  toPublic,
  toSessionUser,
  toView,
  updateBooking,
} from "./core";
import { db } from "./db";
import { popularTimes, utilization } from "./metrics";
import { signToken, windowOf } from "./qr";
import { ctx } from "../context";
import { dropPushSubscriptions, savePushSubscription } from "../push";

const sessionLabel = (b: { start: string; end: string }) => `${fmtDayShort(b.start)}${L(", ", "، ")}${fmtRange(b.start, b.end)}`;
/** The audit log stays in English. */
const enSessionLabel = (b: { start: string; end: string }) => withLanguage("en", () => sessionLabel(b));

/* ─────────────────────────── Facilities ─────────────────────────── */

export function summarize(f: Facility, viewer?: User): FacilitySummary {
  const ix = engine();
  const now = ix.now;
  const cat = ix.category(f.categoryId)!;
  const today = summarizeDay(ix, f, now);
  const hours = f.schedule[now.getDay()];
  const open = takesBookings(ix, f);
  const next = open ? nextAvailable(ix, f, 7) : undefined;
  const maintenanceNow = ix.maintenanceFor(f.id).find((m) => new Date(m.start) <= now && new Date(m.end) > now);
  let openNow = false;
  if (hours && open && !maintenanceNow) {
    const o = sessionTimes(f, now);
    openNow = o.length > 0 && o[0].start <= now && o[o.length - 1].end > now;
  }
  return {
    facility: f,
    category: cat,
    isFavorite: !!viewer && db.state.favorites.some((x) => x.userId === viewer.id && x.facilityId === f.id),
    today: { state: today.state, bookable: today.bookable, hours },
    next: next ? { start: next.start, end: next.end, remaining: next.remaining, capacity: next.capacity } : undefined,
    openNow,
    maintenanceNow,
    utilization7d: utilization(f, addDays(startOfDay(now), -7), 7),
  };
}

/** Archived facilities (or ones in an archived type) are gone as far as students are concerned — history stays. */
const retired = (f: Facility) => !!f.archived || !!db.state.categories.find((c) => c.id === f.categoryId)?.archived;

/** A facility a student may look at: an old link to a retired one reads as not found. */
function openFacility(id: string, u: User): Facility {
  const f = facilityOrThrow(id);
  if (u.role === "student" && retired(f)) throw new ApiError("NOT_FOUND", "We couldn’t find that facility. It may have been removed.");
  return f;
}

export const facilities = {
  async categories() {
    currentUser();
    return [...db.state.categories].filter((c) => c.active && !c.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  },

  async list(): Promise<FacilitySummary[]> {
    const u = requirePermission("facility.view");
    tick();
    const cats = new Map(db.state.categories.map((c) => [c.id, c]));
    return db.state.facilities
      .filter((f) => cats.get(f.categoryId)?.active && !retired(f))
      .sort((a, b) => (cats.get(a.categoryId)!.sortOrder - cats.get(b.categoryId)!.sortOrder) || a.name.localeCompare(b.name))
      .map((f) => summarize(f, u));
  },

  async get(id: string): Promise<FacilityDetail> {
    const u = requirePermission("facility.view");
    const f = openFacility(id, u);
    const s = summarize(f, u);
    const p = policyFor(f);
    const now = clock.now();
    return {
      ...s,
      policy: p,
      policyLines: describePolicy(p, { facilityName: facilityName(f), categoryName: facilityName(s.category), sessionMinutes: f.sessionMinutes, mode: f.mode }),
      popularTimes: popularTimes(f, now),
      upcomingMaintenance: db.state.maintenance.filter((m) => m.facilityId === f.id && !m.cancelled && new Date(m.end) > now).sort((a, b) => a.start.localeCompare(b.start)),
    };
  },

  async availability(facilityId: string, day: string): Promise<Availability> {
    const u = requirePermission("facility.view");
    const f = openFacility(facilityId, u);
    const ix = engine();
    const p = policyFor(f);
    const date = fromDayKey(day);
    // "2026-02-30" would silently become 2 March — say so instead.
    if (Number.isNaN(date.getTime()) || dayKey(date) !== day) throw new ApiError("VALIDATION", "That date isn’t valid.");
    const sessions = daySessions(ix, f, date, { excludeHoldForUserId: u.id });
    const slots = sessions.map((s) => {
      const ev = evaluateBooking(ix, { facilityId, start: s.start, userId: u.id });
      const status = slotStatus(ev);
      return {
        session: ev.session ?? s,
        status,
        reasons: ev.blocking.filter((b) => b.code !== "participants_count"),
        warnings: ev.warnings,
        waitlistPosition: ev.waitlist.position,
        waitlistEntryId: ev.waitlist.entryId,
        bookingId: ev.existingBookingId,
      };
    });
    const span = Math.max(7, p.window.advanceDays + 3);
    const today = startOfDay(ix.now);
    const days = Array.from({ length: span }, (_, i) => {
      const d = addDays(today, i);
      const sum = summarizeDay(ix, f, d);
      return { day: dayKey(d), state: sum.state, bookable: sum.bookable };
    });
    return { facilityId, day, slots, days };
  },

  async evaluate(input: { facilityId: string; start: string; participantIds: string[] }): Promise<Evaluation> {
    const u = requirePermission("booking.create");
    return evaluateBooking(engine(), { ...input, userId: u.id });
  },
};

/* ─────────────────────────── Bookings ─────────────────────────── */

const idempotency = new Map<string, string>();
const recentCreates = new Map<string, number[]>();

const searches = new Map<string, number[]>();
/** A person adding teammates searches a handful of times, not hundreds. */
function limitSearch(userId: string) {
  const now = Date.now();
  const recent = (searches.get(userId) ?? []).filter((t) => now - t < 600_000);
  if (recent.length >= 60) throw new ApiError("RATE_LIMITED", "Too many searches. Please wait a few minutes and try again.");
  recent.push(now);
  searches.set(userId, recent);
}

const invitesSent = new Map<string, number[]>();
/** Invitations (and withdrawals) reach other students' phones — enough for a full squad and a few swaps, not a stream. */
function limitInvites(userId: string, count: number) {
  const now = Date.now();
  const recent = (invitesSent.get(userId) ?? []).filter((t) => now - t < 600_000);
  if (recent.length + count > 20) throw new ApiError("RATE_LIMITED", "You’re sending invitations very quickly. Please wait a few minutes and try again.");
  invitesSent.set(userId, [...recent, ...Array.from({ length: count }, () => now)]);
}

/** The booker, a player who accepted, or someone with an open invitation. `playing` excludes the invitation. */
function mineOrThrow(id: string, u: User, playing = false): Booking {
  const b = bookingOrThrow(id);
  const entry = b.participants.find((p) => p.userId === u.id);
  const ok = b.userId === u.id || (!!entry && (hasJoined(entry) || (!playing && entry.status === "invited")));
  if (!ok) throw new ApiError("NOT_FOUND", "We couldn’t find that booking.");
  return b;
}

/** People to tell when a booking changes: everyone playing, plus open invitations. */
const everyoneListed = (b: Booking) => [...playersOf(b), ...b.participants.filter((p) => p.status === "invited").map((p) => p.userId)];

/** "Tue, 30 Sep, 11:00" — or just the time when it's today. */
const deadlineLabel = (iso: string) => (isSameDay(new Date(iso), clock.now()) ? fmtTime(iso) : `${fmtDayShort(iso)}${L(", ", "، ")}${fmtTime(iso)}`);

/**
 * Keep a booking's status in step with its players: confirm it once enough
 * have accepted, or put it back on hold (with a deadline) when someone leaves
 * and it's short. Returns the booking and what changed.
 */
function settlePlayers(b: Booking, f: Facility): { booking: Booking; change: "confirmed" | "short" | null } {
  const p = policyFor(f);
  const { min } = peopleLimits(f, p);
  const have = playersOf(b).length;
  if (b.status === "AWAITING_PLAYERS" && have >= min) {
    return { booking: updateBooking(b, { status: p.approval.required ? "PENDING" : "CONFIRMED", playersDeadline: undefined }), change: "confirmed" };
  }
  if ((b.status === "CONFIRMED" || b.status === "PENDING") && have < min) {
    return { booking: updateBooking(b, { status: "AWAITING_PLAYERS", playersDeadline: playersDeadline(clock.now(), new Date(b.start), p).toISOString() }), change: "short" };
  }
  return { booking: b, change: null };
}

/** Everyone on a booking that just got its players hears it's on. */
function announceConfirmed(b: Booking, f: Facility) {
  for (const id of playersOf(b)) {
    notify(
      id,
      "booking_confirmed",
      () => (b.status === "PENDING" ? L(`${f.name}: all players are in`, `${facilityName(f)}: اكتمل اللاعبون`) : L(`${f.name} confirmed — everyone’s in`, `تم تأكيد ${facilityName(f)} — اكتمل اللاعبون`)),
      () => (b.status === "PENDING" ? L(`${sessionLabel(b)}. Staff will now review the request.`, `${sessionLabel(b)}. سيراجع الموظفون الطلب الآن.`) : L(`${sessionLabel(b)} · ${f.location.building}. The QR ticket is ready in My Bookings.`, `${sessionLabel(b)} · ${localFacility(f).location.building}. تذكرة QR جاهزة في حجوزاتي.`)),
      { link: `/bookings/${b.id}`, data: { bookingId: b.id } },
    );
  }
}

function inviteNotice(b: Booking, f: Facility, from: User, userId: string) {
  notify(
    userId,
    "invitation",
    () => L(`${from.name} invited you to ${f.name}`, `${from.name} دعاك إلى ${facilityName(f)}`),
    () =>
      b.playersDeadline
        ? L(`${sessionLabel(b)}. Accept by ${deadlineLabel(b.playersDeadline)} — once you accept, it counts towards your own limits.`, `${sessionLabel(b)}. وافق قبل ${deadlineLabel(b.playersDeadline)} — بعد موافقتك يُحتسب الحجز من حدودك أنت أيضًا.`)
        : L(`${sessionLabel(b)}. Accept to join — once you accept, it counts towards your own limits.`, `${sessionLabel(b)}. وافق لتنضم — بعد موافقتك يُحتسب الحجز من حدودك أنت أيضًا.`),
    { link: `/bookings/${b.id}`, data: { bookingId: b.id } },
  );
}

/** Cancellation reason recorded when an account is suspended (bookings released) or closed. */
const ACCOUNT_RELEASED = "Account suspended or closed by the facilities office";

/** Our own default reasons, in the reader's language; anything typed by a person is shown as written. */
const reasonText = (r: string) =>
  ({
    "No reason given": L("No reason given", "بدون سبب"),
    "Cancelled by the facilities office": L("Cancelled by the facilities office", "ألغاه مكتب إدارة المرافق"),
    "Request declined": L("Request declined", "تم رفض الطلب"),
    "Not enough players accepted in time": L("Not enough players accepted in time", "لم يوافق عدد كافٍ من اللاعبين في الوقت المحدد"),
    [ACCOUNT_RELEASED]: L("The student’s account was suspended or closed", "تم إيقاف حساب الطالب أو إغلاقه"),
    "Facility schedule changed": L("The facility’s schedule changed", "تغيّر جدول المرفق"),
  })[r] ?? r;


/**
 * Take a student out of everything still to come: open invitations are
 * declined and waitlist places end (they couldn't use either), and — when
 * `bookings` — their own bookings are cancelled without a strike and they
 * leave other people's. Everyone affected is told.
 */
export function releaseStudent(u: User, actor: User, opts: { bookings: boolean }): { cancelled: number; left: number; declined: number; waitlists: number } {
  const now = clock.now();
  const at = now.toISOString();
  const out = { cancelled: 0, left: 0, declined: 0, waitlists: 0 };
  for (const b of db.state.bookings) {
    if (!UPCOMING_STATUSES.has(b.status) || new Date(b.start) <= now) continue;
    const f = db.state.facilities.find((x) => x.id === b.facilityId);
    if (!f) continue;
    const mine = b.participants.find((p) => p.userId === u.id);
    if (opts.bookings && b.userId === u.id) {
      updateBooking(b, { status: "CANCELLED", playersDeadline: undefined, cancellation: { at, byUserId: actor.id, reason: ACCOUNT_RELEASED, late: false, penalty: false, byRole: actor.role } });
      for (const id of everyoneListed(b)) {
        notify(
          id,
          "booking_cancelled",
          () => L(`${f.name} booking cancelled`, `تم إلغاء حجز ${facilityName(f)}`),
          () => (id === u.id ? L(`The facilities office cancelled ${sessionLabel(b)}. No strike has been recorded.`, `ألغى مكتب إدارة المرافق موعد ${sessionLabel(b)}. لم تُسجّل عليك مخالفة.`) : L(`${u.name}’s booking for ${sessionLabel(b)} was cancelled by the facilities office.`, `ألغى مكتب إدارة المرافق حجز ${u.name} لموعد ${sessionLabel(b)}.`)),
          { data: { bookingId: b.id } },
        );
      }
      offerNext(f.id, b.start);
      out.cancelled++;
    } else if (opts.bookings && mine && hasJoined(mine)) {
      const { booking: next, change } = settlePlayers(updateBooking(b, { participants: b.participants.map((p) => (p.userId === u.id ? { ...p, status: "left" as const, respondedAt: at } : p)) }), f);
      notify(
        b.userId,
        "invitation_response",
        () => L(`${u.name} is no longer on your ${f.name} booking`, `${u.name} لم يعد في حجزك في ${facilityName(f)}`),
        () => (change === "short" && next.playersDeadline ? L(`${sessionLabel(b)} is now short of players. Invite ${N.person(toView(next).playersNeeded)} before ${deadlineLabel(next.playersDeadline)}, or the booking is cancelled.`, `موعد ${sessionLabel(b)} أصبح ينقصه لاعبون. ادعُ ${N.person(toView(next).playersNeeded)} قبل ${deadlineLabel(next.playersDeadline)}، وإلا يُلغى الحجز.`) : L(`${sessionLabel(b)}.`, `${sessionLabel(b)}.`)),
        { link: `/bookings/${b.id}`, data: { bookingId: b.id } },
      );
      out.left++;
    } else if (mine?.status === "invited") {
      updateBooking(b, { participants: b.participants.map((p) => (p.userId === u.id ? { ...p, status: "declined" as const, respondedAt: at } : p)) });
      notify(b.userId, "invitation_response", () => L(`${u.name} can’t make it`, `${u.name} اعتذر`), () => L(`${f.name} · ${sessionLabel(b)}. Invite someone else if you need more players.`, `${facilityName(f)} · ${sessionLabel(b)}. ادعُ شخصًا آخر إذا كنت تحتاج لاعبين.`), { link: `/bookings/${b.id}`, data: { bookingId: b.id } });
      out.declined++;
    }
  }
  for (const w of db.state.waitlist) {
    if (w.userId !== u.id || (w.status !== "waiting" && w.status !== "offered")) continue;
    db.put("waitlist", { ...w, status: "cancelled" });
    if (w.status === "offered") offerNext(w.facilityId, w.start);
    out.waitlists++;
  }
  return out;
}

function eventsFor(b: Booking): BookingEvent[] {
  const users = new Map(db.state.users.map((u) => [u.id, u]));
  const name = (id: string) => (id === "system" ? L("System", "النظام") : users.get(id)?.name ?? L("Staff", "الموظفين"));
  const by = (id: string) => L(`by ${name(id)}`, `بواسطة ${name(id)}`);
  const ev: BookingEvent[] = [];
  const f = db.state.facilities.find((x) => x.id === b.facilityId)!;
  ev.push({ at: b.createdAt, label: b.source === "waitlist" ? L("Claimed from the waitlist", "حُجز من قائمة الانتظار") : b.source === "admin" ? L("Booked by the facilities office", "حجزه مكتب إدارة المرافق") : L("Booked", "تم الحجز"), detail: by(b.userId), tone: "info" });
  if (b.approval) ev.push({ at: b.approval.at, label: b.approval.decision === "approved" ? L("Approved", "تمت الموافقة") : L("Declined", "مرفوض"), detail: `${by(b.approval.byUserId)}${b.approval.note ? ` — ${b.approval.note}` : ""}`, tone: b.approval.decision === "approved" ? "success" : "danger" });
  if (b.reminderSentAt) ev.push({ at: b.reminderSentAt, label: L("Reminder sent", "تم إرسال التذكير"), tone: "neutral" });
  if (b.checkIn) ev.push({ at: b.checkIn.at, label: L("Checked in", "تم تسجيل الحضور"), detail: `${b.checkIn.method === "qr" ? L("QR scan", "مسح QR") : L("Manual check-in", "تسجيل يدوي")} ${by(b.checkIn.byUserId)}${b.checkIn.headcount ? ` · ${N.person(b.checkIn.headcount)}` : ""}`, tone: "success" });
  if (b.noShow) ev.push({ at: b.noShow.at, label: L("Marked as no-show", "تم تسجيل غياب"), detail: b.noShow.auto ? L("Grace period ended without check-in", "انتهت فترة السماح بدون تسجيل حضور") : by(b.noShow.byUserId as string), tone: "danger" });
  if (b.noShow?.waived) ev.push({ at: b.noShow.waived.at, label: L("Strike waived", "أُلغيت المخالفة"), detail: b.noShow.waived.reason, tone: "success" });
  for (const p of b.participants) {
    if (p.respondedAt && p.status !== "invited") ev.push({ at: p.respondedAt, label: p.status === "declined" ? L(`${name(p.userId)} declined`, `${name(p.userId)} اعتذر`) : p.status === "left" ? L(`${name(p.userId)} left`, `${name(p.userId)} خرج`) : L(`${name(p.userId)} accepted`, `${name(p.userId)} وافق`), tone: p.status === "accepted" ? "success" : "neutral" });
  }
  if (b.cancellation) ev.push({ at: b.cancellation.at, label: b.cancellation.late ? L("Cancelled late", "أُلغي متأخرًا") : L("Cancelled", "أُلغي"), detail: `${b.cancellation.byRole === "student" ? by(b.cancellation.byUserId) : b.cancellation.byRole === "system" ? L("automatically", "تلقائيًا") : L("by the facilities office", "بواسطة مكتب إدارة المرافق")} — ${reasonText(b.cancellation.reason)}`, tone: b.cancellation.penalty ? "danger" : "neutral" });
  if (b.status === "COMPLETED") ev.push({ at: b.end, label: L("Completed", "مكتمل"), detail: facilityName(f), tone: "success" });
  if (b.status === "EXPIRED") ev.push({ at: b.expiredAt ?? b.start, label: L("Expired", "منتهي"), detail: L("Not approved before the session started", "لم تتم الموافقة قبل بداية الموعد"), tone: "neutral" });
  return ev.sort((a, c) => a.at.localeCompare(c.at));
}

export function standingInfo(userId: string): StandingInfo {
  const ix = engine();
  const user = db.state.users.find((u) => u.id === userId);
  const standing = standingFor(userId);
  const now = ix.now;
  const facs = new Map(db.state.facilities.map((f) => [f.id, f]));
  const mine = ix.involvements(userId).filter((b) => USAGE_STATUSES.has(b.status));
  const wkStart = startOfWeek(now, { weekStartsOn: db.state.settings.weekStartsOn });
  const wkEnd = addDays(wkStart, 7);
  const usage = db.state.categories
    .filter((c) => c.active && !c.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => {
      const sample = db.state.facilities.find((f) => f.categoryId === c.id && f.status === "active") ?? db.state.facilities.find((f) => f.categoryId === c.id)!;
      const p = policyFor(sample);
      const inCat = mine.filter((b) => facs.get(b.facilityId)?.categoryId === c.id);
      return {
        scopeId: c.id,
        name: facilityName(c),
        color: c.color,
        today: inCat.filter((b) => startOfDay(new Date(b.start)).getTime() === startOfDay(now).getTime()).length,
        perDay: p.limits.perDay,
        week: inCat.filter((b) => new Date(b.start) >= wkStart && new Date(b.start) < wkEnd).length,
        perWeek: p.limits.perWeek,
        active: inCat.filter((b) => b.userId === userId && UPCOMING_STATUSES.has(b.status) && new Date(b.end) > now).length,
        maxActive: p.limits.maxActive,
      };
    });
  const campusActive = mine.filter((b) => b.userId === userId && UPCOMING_STATUSES.has(b.status) && new Date(b.end) > now).length;
  const waitlists = db.state.waitlist.filter((w) => w.userId === userId && (w.status === "waiting" || w.status === "offered") && new Date(w.start) > now).length;
  return {
    standing,
    strikesDetail: [...standing.strikes, ...standing.expired].map((s) => ({ bookingId: s.bookingId, facilityName: facs.get(s.facilityId)?.name ?? "Facility", type: s.type, at: s.at, expiresAt: s.expiresAt })),
    usage,
    campus: { active: campusActive, maxActive: db.state.globalPolicy.campus.maxActiveBookings, waitlists, maxWaitlists: db.state.globalPolicy.campus.maxActiveWaitlists },
    suspended: user?.status === "suspended" ? { reason: user.statusNote?.reason, since: user.statusNote?.at ?? now.toISOString() } : undefined,
  };
}

function waitlistView(w: WaitlistEntry): WaitlistView {
  const f = db.state.facilities.find((x) => x.id === w.facilityId)!;
  const cat = db.state.categories.find((c) => c.id === f.categoryId)!;
  const queue = db.state.waitlist.filter((x) => x.facilityId === w.facilityId && x.start === w.start && (x.status === "waiting" || x.status === "offered")).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pos = queue.findIndex((x) => x.id === w.id) + 1;
  return { entry: w, facility: f, category: cat, position: pos, queueLength: queue.length, claimMinutes: policyFor(f).waitlist.claimMinutes };
}

function createBookingRecord(u: User, f: Facility, ev: Evaluation, input: { start: string; participantIds: string[]; purpose?: string }, source: Booking["source"]): Booking {
  const p = policyFor(f);
  const now = clock.now();
  const session = ev.session!;
  // Listed people are invitations until they accept from their own phone.
  const invitees = [...new Set(input.participantIds.filter((x) => x !== u.id))];
  const short = peopleLimits(f, p).min > 1;
  const b: Booking = {
    id: db.nextBookingId(),
    facilityId: f.id,
    userId: u.id,
    unitIndex: session.freeUnitIndex,
    start: session.start,
    end: session.end,
    status: short ? "AWAITING_PLAYERS" : p.approval.required ? "PENDING" : "CONFIRMED",
    participants: invitees.map((userId) => ({ userId, status: "invited", invitedAt: now.toISOString() })),
    playersDeadline: short ? playersDeadline(now, new Date(session.start), p).toISOString() : undefined,
    purpose: input.purpose?.trim() || undefined,
    source,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    version: 1,
  };
  db.put("bookings", b);
  return b;
}

function afterCreate(u: User, f: Facility, b: Booking, ev: Evaluation): boolean {
  // Leave any waitlist the student was on for this session.
  for (const w of db.state.waitlist) {
    if (w.userId === u.id && w.facilityId === f.id && w.start === b.start && (w.status === "waiting" || w.status === "offered")) db.put("waitlist", { ...w, status: "claimed", bookingId: b.id });
  }
  if (b.status === "AWAITING_PLAYERS") {
    const needed = peopleLimits(f, policyFor(f)).min - 1;
    notify(u.id, "booking_pending", () => L(`${f.name}: waiting for your players`, `${facilityName(f)}: في انتظار اللاعبين`), () => L(`${sessionLabel(b)}. Invitations sent — the booking is confirmed once ${needed} ${needed === 1 ? "player accepts" : "players accept"} by ${deadlineLabel(b.playersDeadline!)}.`, `${sessionLabel(b)}. تم إرسال الدعوات — يتأكد الحجز عندما يوافق ${N.person(needed)} قبل ${deadlineLabel(b.playersDeadline!)}.`), { link: `/bookings/${b.id}`, data: { bookingId: b.id } });
  } else if (b.status === "PENDING") {
    notify(u.id, "booking_pending", () => L(`${f.name} request sent`, `تم إرسال طلب ${facilityName(f)}`), () => L(`${sessionLabel(b)}. Staff will review your request — we’ll let you know as soon as it’s approved.`, `${sessionLabel(b)}. سيراجع الموظفون طلبك — وسنُبلغك فور الموافقة عليه.`), { link: `/bookings/${b.id}`, data: { bookingId: b.id } });
  } else {
    notify(u.id, "booking_confirmed", () => L(`${f.name} confirmed`, `تم تأكيد حجز ${facilityName(f)}`), () => L(`${sessionLabel(b)} · ${f.location.building}. Your QR ticket is ready in My Bookings.`, `${sessionLabel(b)} · ${localFacility(f).location.building}. تذكرة QR جاهزة في حجوزاتي.`), { link: `/bookings/${b.id}`, data: { bookingId: b.id } });
  }
  for (const pt of b.participants) inviteNotice(b, f, u, pt.userId);
  audit(u, b.status === "PENDING" ? "booking.request" : "booking.create", "booking", b.id, b.id, `${b.status === "PENDING" ? "Requested" : "Booked"} ${f.name} for ${enSessionLabel(b)}${b.participants.length ? `, inviting ${b.participants.length} ${b.participants.length === 1 ? "player" : "players"}` : ""}`);
  let flagged = false;
  const lg = ev.linkedGroup;
  if (lg && policyFor(f).fairness.linkedGroups.action === "flag") {
    const flag: FairnessFlag = {
      id: `FF-${200 + db.nextSeq()}`,
      type: "linked_back_to_back",
      status: "open",
      createdAt: clock.now().toISOString(),
      facilityId: f.id,
      userIds: [...new Set([lg.memberId, lg.otherId])],
      bookingIds: [lg.neighborBookingId, b.id],
      summary: `Back-to-back ${f.name} sessions by students who have shared ${lg.sharedSessions} bookings recently.`,
      evidence: { sharedSessions: lg.sharedSessions, lookbackDays: policyFor(f).fairness.linkedGroups.lookbackDays, occurrences: 1 },
    };
    db.put("flags", flag);
    audit("system", "flag.create", "flag", flag.id, f.name, "Booking-time fair-use check flagged a linked group for review");
    flagged = true;
  }
  return flagged;
}

export const bookings = {
  async mine(): Promise<BookingView[]> {
    const u = currentUser();
    tick();
    const now = clock.now();
    const openInvite = (b: Booking) => UPCOMING_STATUSES.has(b.status) && new Date(b.start) > now;
    return db.state.bookings
      .filter((b) => b.userId === u.id || b.participants.some((p) => p.userId === u.id && (hasJoined(p) || (p.status === "invited" && openInvite(b)))))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((b) => toView(b, u.id));
  },

  async get(id: string): Promise<BookingDetail> {
    const u = currentUser();
    const b = u.role === "student" ? mineOrThrow(id, u) : bookingOrThrow(id);
    const view = toView(b, u.id);
    const p = policyFor(view.facility);
    return {
      ...view,
      events: eventsFor(b),
      policyLines: describePolicy(p, { facilityName: facilityName(view.facility), categoryName: facilityName(view.category), sessionMinutes: view.facility.sessionMinutes, mode: view.facility.mode }),
      waitlistCount: db.state.waitlist.filter((w) => w.facilityId === b.facilityId && w.start === b.start && (w.status === "waiting" || w.status === "offered")).length,
    };
  },

  async create(input: CreateBookingInput): Promise<CreateBookingResult> {
    const u = requirePermission("booking.create");
    requireActiveAccount(u);
    const idemKey = `${u.id}:${input.idempotencyKey}`;
    const existing = idempotency.get(idemKey);
    if (existing) {
      const b = db.state.bookings.find((x) => x.id === existing);
      if (b) return { booking: toView(b, u.id), flagged: false };
    }
    const now = Date.now();
    const recent = (recentCreates.get(u.id) ?? []).filter((t) => now - t < 60000);
    if (recent.length >= db.state.settings.bookingRateLimitPerMinute) throw new ApiError("RATE_LIMITED", "You’re booking very quickly. Please wait a minute and try again.");
    recentCreates.set(u.id, [...recent, now]);

    return db.transaction(() => {
      const f = facilityOrThrow(input.facilityId);
      const ev = evaluateBooking(engine(), { facilityId: f.id, start: input.start, userId: u.id, participantIds: input.participantIds });
      if (!ev.ok) {
        // "Full" is only the answer when nothing else stands in the way — a paused or ineligible student is told why.
        const other = ev.blocking.find((r) => r.code !== "full" && r.code !== "participants_count");
        if (!other && ev.blocking.some((r) => r.code === "full")) throw new ApiError("CONFLICT", "Someone booked the last spot a moment before you.", ev.blocking, { canWaitlist: ev.waitlist.possible });
        throw new ApiError("RULE_VIOLATION", (other ?? ev.blocking[0]).message, ev.blocking);
      }
      const b = createBookingRecord(u, f, ev, input, "student");
      idempotency.set(idemKey, b.id);
      const flagged = afterCreate(u, f, b, ev);
      return { booking: toView(b, u.id), flagged };
    });
  },

  /**
   * Answer an invitation from your own phone. Accepting checks your own limits
   * now and makes the booking count towards them; nothing counts before that.
   */
  async respond(id: string, answer: "accept" | "decline"): Promise<BookingView> {
    const u = requirePermission("booking.create");
    return db.transaction(() => {
      const b = bookingOrThrow(id);
      const entry = b.participants.find((p) => p.userId === u.id);
      if (!entry) throw new ApiError("NOT_FOUND", "We couldn’t find that booking.");
      if (entry.status !== "invited") throw new ApiError("CONFLICT", hasJoined(entry) ? L("You’ve already accepted this invitation.", "لقد وافقت على هذه الدعوة بالفعل.") : L("This invitation is no longer open.", "هذه الدعوة لم تعد متاحة."));
      // Past the deadline the booking is about to be released — the scheduler just hasn't run yet.
      if (answer === "accept" && b.status === "AWAITING_PLAYERS" && b.playersDeadline && new Date(b.playersDeadline) <= clock.now()) throw new ApiError("CONFLICT", L("Too late — the time to accept has passed and the session is being released.", "فات الوقت — انتهت مهلة القبول ويتم إتاحة الموعد لغيرك."));
      const f = facilityOrThrow(b.facilityId);
      const now = clock.now().toISOString();
      const mark = (status: "accepted" | "declined") => b.participants.map((p) => (p.userId === u.id ? { ...p, status, respondedAt: now } : p));
      if (answer === "decline") {
        const next = updateBooking(b, { participants: mark("declined") });
        notify(b.userId, "invitation_response", () => L(`${u.name} can’t make it`, `${u.name} اعتذر`), () => (next.status === "AWAITING_PLAYERS" && next.playersDeadline ? L(`${f.name} · ${sessionLabel(b)}. Invite someone else before ${deadlineLabel(next.playersDeadline)}, or the booking is cancelled.`, `${facilityName(f)} · ${sessionLabel(b)}. ادعُ شخصًا آخر قبل ${deadlineLabel(next.playersDeadline)}، وإلا يُلغى الحجز.`) : L(`${f.name} · ${sessionLabel(b)}.`, `${facilityName(f)} · ${sessionLabel(b)}.`)), { link: `/bookings/${b.id}`, data: { bookingId: b.id } });
        audit(u, "booking.decline", "booking", b.id, b.id, `Declined an invitation to ${f.name}, ${enSessionLabel(b)}`);
        return toView(next, u.id);
      }
      requireActiveAccount(u);
      const ev = evaluateJoin(engine(), b, u.id);
      if (!ev.ok) throw new ApiError("RULE_VIOLATION", ev.blocking[0].message, ev.blocking);
      const { booking: next, change } = settlePlayers(updateBooking(b, { participants: mark("accepted") }), f);
      if (change === "confirmed") announceConfirmed(next, f);
      else notify(b.userId, "invitation_response", () => L(`${u.name} is in`, `${u.name} انضم`), () => (next.status === "AWAITING_PLAYERS" && next.playersDeadline ? L(`${f.name} · ${sessionLabel(b)}. Still waiting for ${N.person(toView(next).playersNeeded)} to accept by ${deadlineLabel(next.playersDeadline)}.`, `${facilityName(f)} · ${sessionLabel(b)}. في انتظار موافقة ${N.person(toView(next).playersNeeded)} قبل ${deadlineLabel(next.playersDeadline)}.`) : L(`${f.name} · ${sessionLabel(b)}.`, `${facilityName(f)} · ${sessionLabel(b)}.`)), { link: `/bookings/${b.id}`, data: { bookingId: b.id } });
      audit(u, "booking.accept", "booking", b.id, b.id, `Accepted an invitation to ${f.name}, ${enSessionLabel(b)}`);
      return toView(next, u.id);
    });
  },

  /** The booker invites more players — e.g. to replace someone who declined. */
  async invite(id: string, userIds: string[]): Promise<BookingView> {
    const u = requirePermission("booking.create");
    requireActiveAccount(u);
    return db.transaction(() => {
      const b = bookingOrThrow(id);
      if (b.userId !== u.id) throw new ApiError("NOT_FOUND", "We couldn’t find that booking.");
      if (!UPCOMING_STATUSES.has(b.status) || new Date(b.start) <= clock.now()) throw new ApiError("CONFLICT", "This booking has already started or ended.");
      const f = facilityOrThrow(b.facilityId);
      const ix = engine();
      const open = (x: string) => b.participants.some((p) => p.userId === x && (hasJoined(p) || p.status === "invited"));
      const fresh = [...new Set(userIds)].filter((x) => x !== u.id && !open(x));
      if (!fresh.length) throw new ApiError("VALIDATION", L("Everyone you picked is already on this booking.", "كل من اخترتهم موجودون في الحجز بالفعل."));
      for (const x of fresh) {
        const who = ix.user(x);
        if (!who || who.role !== "student" || who.status !== "active" || !ix.onRoster(who)) throw new ApiError("VALIDATION", L("One of the people you added isn’t an active student.", "أحد الأشخاص الذين أضفتهم ليس طالبًا نشطًا."));
      }
      const { max } = peopleLimits(f, policyFor(f));
      const listed = b.participants.filter((p) => hasJoined(p) || p.status === "invited").length;
      if (1 + listed + fresh.length > max) throw new ApiError("RULE_VIOLATION", L(`${f.name} allows up to ${max} people per booking.`, `يسمح ${facilityName(f)} بحد أقصى ${N.person(max)} في الحجز الواحد.`));
      limitInvites(u.id, fresh.length);
      const now = clock.now().toISOString();
      const next = updateBooking(b, { participants: [...b.participants.filter((p) => !fresh.includes(p.userId)), ...fresh.map((userId) => ({ userId, status: "invited" as const, invitedAt: now }))] });
      for (const x of fresh) inviteNotice(next, f, u, x);
      audit(u, "booking.invite", "booking", b.id, b.id, `Invited ${fresh.length} more ${fresh.length === 1 ? "player" : "players"} to ${f.name}, ${enSessionLabel(b)}`);
      return toView(next, u.id);
    });
  },

  /** The booker withdraws an invitation nobody has answered yet. */
  async uninvite(id: string, userId: string): Promise<BookingView> {
    const u = requirePermission("booking.create");
    return db.transaction(() => {
      const b = bookingOrThrow(id);
      if (b.userId !== u.id) throw new ApiError("NOT_FOUND", "We couldn’t find that booking.");
      if (!b.participants.some((p) => p.userId === userId && p.status === "invited")) throw new ApiError("CONFLICT", L("Only invitations that haven’t been answered can be withdrawn.", "يمكن سحب الدعوات التي لم يُرد عليها فقط."));
      limitInvites(u.id, 1);
      const f = facilityOrThrow(b.facilityId);
      const next = updateBooking(b, { participants: b.participants.filter((p) => p.userId !== userId) });
      notify(userId, "invitation_response", () => L(`${u.name} withdrew the invitation`, `${u.name} سحب الدعوة`), () => L(`You’re no longer invited to ${f.name}, ${sessionLabel(b)}.`, `لم تعد مدعوًا إلى ${facilityName(f)}، ${sessionLabel(b)}.`), { link: "/bookings" });
      audit(u, "booking.uninvite", "booking", b.id, b.id, "Withdrew an invitation");
      return toView(next, u.id);
    });
  },

  /**
   * Take yourself off someone else's booking. It stops counting towards your
   * limits — and if that leaves the booking short of players, it goes back on
   * hold until the booker finds someone, or it's cancelled.
   */
  async leave(id: string) {
    const u = currentUser();
    await db.transaction(() => {
      const b = bookingOrThrow(id);
      if (!b.participants.some((p) => p.userId === u.id && hasJoined(p))) throw new ApiError("NOT_FOUND", "We couldn’t find that booking.");
      if (!UPCOMING_STATUSES.has(b.status) || new Date(b.start) <= clock.now()) throw new ApiError("CONFLICT", "This booking has already started or ended.");
      const f = facilityOrThrow(b.facilityId);
      const now = clock.now().toISOString();
      const { booking: next, change } = settlePlayers(updateBooking(b, { participants: b.participants.map((p) => (p.userId === u.id ? { ...p, status: "left" as const, respondedAt: now } : p)) }), f);
      notify(
        b.userId,
        "invitation_response",
        () => L(`${u.name} left your ${f.name} booking`, `${u.name} خرج من حجزك في ${facilityName(f)}`),
        () =>
          change === "short" && next.playersDeadline
            ? L(`${sessionLabel(b)} is now short of players. Invite ${N.person(toView(next).playersNeeded)} before ${deadlineLabel(next.playersDeadline)}, or the booking is cancelled.`, `موعد ${sessionLabel(b)} أصبح ينقصه لاعبون. ادعُ ${N.person(toView(next).playersNeeded)} قبل ${deadlineLabel(next.playersDeadline)}، وإلا يُلغى الحجز.`)
            : L(`${u.name} is no longer listed for ${sessionLabel(b)}.`, `${u.name} لم يعد مسجّلًا في موعد ${sessionLabel(b)}.`),
        { link: `/bookings/${b.id}`, data: { bookingId: b.id } },
      );
      audit(u, "booking.leave", "booking", b.id, b.id, `Removed themselves from ${f.name}, ${enSessionLabel(b)}${change === "short" ? " — booking now waiting for players" : ""}`);
    });
  },

  async cancel(id: string, reason: string): Promise<CancelResult> {
    const u = requirePermission("booking.cancel.own");
    return db.transaction(() => {
      const b = bookingOrThrow(id);
      if (b.userId !== u.id) throw new ApiError("FORBIDDEN", b.participants.some((p) => p.userId === u.id) ? "Only the person who made the booking can cancel it. Ask them to cancel, or to remove you." : "We couldn’t find that booking.");
      const f = facilityOrThrow(b.facilityId);
      const info = cancelInfo(b, f);
      if (!info.allowed) throw new ApiError("CONFLICT", info.reason ?? "This booking can no longer be cancelled.");
      const next = updateBooking(b, { status: "CANCELLED", playersDeadline: undefined, cancellation: { at: clock.now().toISOString(), byUserId: u.id, reason: reason || "No reason given", late: info.late, penalty: info.penalty, byRole: "student" } });
      if (info.penalty) applyLadder(u.id, u);
      for (const id of everyoneListed(b)) if (id !== u.id) notify(id, "booking_cancelled", () => L(`${f.name} booking cancelled`, `تم إلغاء حجز ${facilityName(f)}`), () => L(`${u.name} cancelled ${sessionLabel(b)}.`, `ألغى ${u.name} موعد ${sessionLabel(b)}.`), { data: { bookingId: b.id } });
      audit(u, "booking.cancel", "booking", b.id, b.id, `Cancelled ${f.name}, ${enSessionLabel(b)}${info.late ? " (late)" : ""}`);
      // Every upcoming status holds a space (a request waiting for approval too), so it's freed now.
      const offered = offerNext(f.id, b.start);
      return { booking: toView(next, u.id), offeredToNext: !!offered };
    });
  },

  async qr(id: string): Promise<{ token: string; expiresAt: string; rotationSeconds: number }> {
    const u = currentUser();
    const b = mineOrThrow(id, u, true);
    if (b.status !== "CONFIRMED" && b.status !== "CHECKED_IN") throw new ApiError("CONFLICT", "A QR code is only available for confirmed bookings.");
    const rot = db.state.settings.qrRotationSeconds;
    const nowMs = clock.now().getTime();
    const w = windowOf(nowMs, rot);
    const token = await signToken({ b: b.id, u: b.userId, f: b.facilityId, s: b.start, w });
    return { token, expiresAt: new Date((w + 1) * rot * 1000).toISOString(), rotationSeconds: rot };
  },
};

/* ─────────────────────────── Waitlist ─────────────────────────── */

export const waitlist = {
  async mine(): Promise<WaitlistView[]> {
    const u = currentUser();
    const now = clock.now();
    return db.state.waitlist
      .filter((w) => w.userId === u.id && (((w.status === "waiting" || w.status === "offered") && new Date(w.end) > now) || ((w.status === "expired" || w.status === "left") && new Date(w.start) > addDays(now, -2))))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map(waitlistView);
  },

  async join(facilityId: string, start: string): Promise<WaitlistView> {
    const u = requirePermission("waitlist.join");
    requireActiveAccount(u);
    return db.transaction(() => {
      const f = facilityOrThrow(facilityId);
      const ix = engine();
      const ev = evaluateBooking(ix, { facilityId, start, userId: u.id, forWaitlist: true });
      if (ev.waitlist.entryId) throw new ApiError("CONFLICT", L(`You’re already #${ev.waitlist.position} on this waitlist.`, `أنت بالفعل رقم #${ev.waitlist.position} في قائمة الانتظار هذه.`));
      if (!ev.session || ev.session.remaining > 0) throw new ApiError("CONFLICT", "Good news — a spot is available, so you can book it directly.");
      const blocking = ev.blocking.filter((r) => r.code !== "participants_count");
      if (blocking.length) throw new ApiError("RULE_VIOLATION", L(`Even if a spot opens, you couldn’t take it: ${blocking[0].message}`, `حتى لو توفر مكان، لن تستطيع حجزه: ${blocking[0].message}`), blocking);
      const p = policyFor(f);
      const queue = db.state.waitlist.filter((w) => w.facilityId === facilityId && w.start === ev.session!.start && (w.status === "waiting" || w.status === "offered"));
      if (!p.waitlist.enabled) throw new ApiError("RULE_VIOLATION", "This facility doesn’t use a waitlist.");
      if (queue.length >= p.waitlist.maxPerSession) throw new ApiError("RULE_VIOLATION", L(`The waitlist for this session is full (${p.waitlist.maxPerSession} students).`, `قائمة الانتظار لهذا الموعد ممتلئة (${N.student(p.waitlist.maxPerSession)}).`));
      const mineActive = db.state.waitlist.filter((w) => w.userId === u.id && (w.status === "waiting" || w.status === "offered") && new Date(w.start) > ix.now).length;
      if (mineActive >= p.campus.maxActiveWaitlists) throw new ApiError("RULE_VIOLATION", L(`You’re already on ${mineActive} waitlists — the most at once. Leave one to join another.`, `أنت بالفعل في ${mineActive} قوائم انتظار — وهو الحد الأقصى. غادر إحداها لتنضم لأخرى.`));
      const w: WaitlistEntry = { id: `WL-${5000 + db.nextSeq()}`, facilityId, start: ev.session.start, end: ev.session.end, userId: u.id, createdAt: clock.now().toISOString(), status: "waiting" };
      db.put("waitlist", w);
      const view = waitlistView(w);
      notify(u.id, "waitlist_joined", () => L(`You’re #${view.position} on the ${f.name} waitlist`, `ترتيبك #${view.position} في قائمة انتظار ${facilityName(f)}`), () => L(`${sessionLabel(w)}. We’ll hold a spot for you for ${p.waitlist.claimMinutes} minutes when one opens.`, `${sessionLabel(w)}. عند توفر مكان سنحجزه لك لمدة ${N.minute(p.waitlist.claimMinutes)}.`), { link: "/bookings?tab=waitlist" });
      audit(u, "waitlist.join", "waitlist", w.id, f.name, `Joined the waitlist for ${enSessionLabel(w)} at position #${view.position}`);
      return view;
    });
  },

  async leave(entryId: string) {
    const u = currentUser();
    return db.transaction(() => {
      const w = db.state.waitlist.find((x) => x.id === entryId && x.userId === u.id);
      if (!w) throw new ApiError("NOT_FOUND", "That waitlist entry no longer exists.");
      db.put("waitlist", { ...w, status: "left" });
      const f = facilityOrThrow(w.facilityId);
      audit(u, "waitlist.leave", "waitlist", w.id, f.name, `Left the waitlist for ${enSessionLabel(w)}${w.status === "offered" ? " (declined offer)" : ""}`);
      if (w.status === "offered") offerNext(w.facilityId, w.start);
    });
  },

  async claim(entryId: string, participantIds: string[]): Promise<CreateBookingResult> {
    const u = requirePermission("booking.create");
    requireActiveAccount(u);
    return db.transaction(() => {
      const w = db.state.waitlist.find((x) => x.id === entryId && x.userId === u.id);
      if (!w) throw new ApiError("NOT_FOUND", "That offer no longer exists.");
      if (w.status !== "offered" || !w.offerExpiresAt || new Date(w.offerExpiresAt) <= clock.now()) throw new ApiError("CONFLICT", "This offer has expired and the spot has moved to the next student.");
      const f = facilityOrThrow(w.facilityId);
      const ev = evaluateBooking(engine(), { facilityId: f.id, start: w.start, userId: u.id, participantIds });
      if (!ev.ok) throw new ApiError("RULE_VIOLATION", ev.blocking[0].message, ev.blocking);
      const b = createBookingRecord(u, f, ev, { start: w.start, participantIds }, "waitlist");
      const flagged = afterCreate(u, f, b, ev);
      return { booking: toView(b, u.id), flagged };
    });
  },
};

/* ─────────────────────────── Me ─────────────────────────── */

export const me = {
  async notifications() {
    const u = currentUser();
    tick();
    return db.state.notifications.filter((n) => n.userId === u.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async markRead(ids: string[] | "all") {
    const u = currentUser();
    return db.transaction(() => {
      const now = clock.now().toISOString();
      for (const n of db.state.notifications) if (n.userId === u.id && !n.readAt && (ids === "all" || ids.includes(n.id))) db.put("notifications", { ...n, readAt: now });
    });
  },

  async favorites(): Promise<FacilitySummary[]> {
    const u = currentUser();
    const ids = db.state.favorites.filter((f) => f.userId === u.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((f) => f.facilityId);
    return ids.map((id) => db.state.facilities.find((f) => f.id === id)).filter((f): f is Facility => !!f && !retired(f)).map((f) => summarize(f, u));
  },

  async toggleFavorite(facilityId: string): Promise<boolean> {
    const u = currentUser();
    return db.transaction(() => {
      const id = `${u.id}:${facilityId}`;
      const exists = db.state.favorites.some((f) => f.id === id);
      if (exists) db.remove("favorites", id);
      else {
        // Removing an old favourite always works; adding needs a facility students can see.
        openFacility(facilityId, u);
        db.put("favorites", { id, userId: u.id, facilityId, createdAt: clock.now().toISOString() });
      }
      return !exists;
    });
  },

  async standing(): Promise<StandingInfo> {
    const u = currentUser();
    return standingInfo(u.id);
  },

  async updatePreferences(prefs: Partial<UserPreferences>) {
    const u = currentUser();
    return db.transaction(() => {
      const next = { ...u, preferences: { reminderMinutes: 60, waitlistAlerts: true, emailDigest: false, ...u.preferences, ...prefs } };
      db.put("users", next);
      return toSessionUser(next);
    });
  },

  /** Participant picker — returns only names and IDs, never contact details. */
  /**
   * Find a student to add to a booking: by their full university ID, or by at
   * least three letters of their name. IDs come back masked, so the student
   * directory can't be harvested a few digits at a time.
   */
  async searchStudents(q: string): Promise<PublicUser[]> {
    const u = currentUser();
    requireActiveAccount(u);
    limitSearch(u.id);
    const term = q.trim().toLowerCase();
    const digits = /^\d+$/.test(term);
    if (digits ? term.length < 5 : term.length < 3) return [];
    const ix = engine();
    return db.state.users
      .filter((x) => x.role === "student" && x.id !== u.id && x.status === "active" && ix.onRoster(x))
      .filter((x) => (digits ? x.universityId === term : x.name.toLowerCase().includes(term) || !!x.nameAr?.includes(q.trim())))
      .slice(0, 6)
      .map((x) => ({ ...toPublic(x), universityId: maskedId(x.universityId) }));
  },

  /** People the student most often books with — one-tap squad building. */
  async teammates(): Promise<{ user: PublicUser; shared: number }[]> {
    const u = currentUser();
    const since = addDays(clock.now(), -60);
    const counts = new Map<string, number>();
    for (const b of engine().involvements(u.id)) {
      if (new Date(b.start) < since || b.status === "CANCELLED") continue;
      for (const id of playersOf(b)) if (id !== u.id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const users = new Map(db.state.users.map((x) => [x.id, x]));
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, shared]) => ({ user: { ...toPublic(users.get(id)), universityId: maskedId(users.get(id)?.universityId) }, shared }));
  },

  /** This phone wants notifications for the signed-in account (Web Push). */
  async subscribePush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    const u = currentUser();
    const c = ctx();
    if (!c.deviceId) throw new ApiError("VALIDATION", "Your browser blocked the cookie this app needs. Allow cookies for this site and try again.");
    await db.transaction(() => savePushSubscription(u.id, c.deviceId!, sub), { silent: true });
  },

  /** Stop notifications on this phone. */
  async unsubscribePush() {
    const u = currentUser();
    const deviceId = ctx().deviceId;
    await db.transaction(() => dropPushSubscriptions((s) => s.userId === u.id && s.deviceId === deviceId), { silent: true });
  },

  /** A notification right now, to check they arrive on this phone. */
  async testPush() {
    const u = currentUser();
    const now = Date.now();
    if (now - (lastTest.get(u.id) ?? 0) < 20_000) throw new ApiError("RATE_LIMITED", L("Wait a few seconds before sending another test.", "انتظر ثواني قبل إرسال تجربة أخرى."));
    lastTest.set(u.id, now);
    await db.transaction(() => notify(u.id, "device_decision", () => L("Notifications are on", "الإشعارات تعمل"), () => L("You’ll get reminders, invitations and waitlist offers on this phone.", "ستصلك التذكيرات والدعوات وعروض قائمة الانتظار على هذا الموبايل."), { link: "/profile" }));
  },
};

const lastTest = new Map<string, number>();

