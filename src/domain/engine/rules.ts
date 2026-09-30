import { addDays, addMinutes, isSameDay, startOfDay, startOfWeek } from "date-fns";
import { fmtMinutes } from "../policy";
import { facilityName, localFacility } from "../localize";
import { L, N, arCount } from "@/i18n/lang";
import { fmtRange, fmtTime, fmtDayShort, overlaps } from "@/lib/time";
import type { Booking, BookingPolicy, Facility, ID, User } from "../types";
import { describeSession, findSession, takesBookings, type SessionInfo } from "./sessions";
import { EngineIndex, UPCOMING_STATUSES, USAGE_STATUSES, hasJoined, playersOf } from "./snapshot";
import { computeStanding } from "./standing";

/**
 * The booking rule pipeline.
 *
 * `evaluateBooking` is a pure function over an EngineSnapshot. The UI calls it
 * to explain every slot before the student taps it; the API calls the very same
 * function again inside a lock at commit time, so a stale screen can never
 * create a booking the rules would reject.
 *
 * People added to a booking are invitations: they only count once they accept
 * from their own phone, and `evaluateJoin` checks their own limits at that
 * moment. The booker never learns why someone else can't join.
 */

export type RuleCode =
  | "not_a_session"
  | "facility_inactive"
  | "account_suspended"
  | "restricted"
  | "eligibility"
  | "past"
  | "lead_time"
  | "not_open"
  | "maintenance"
  | "already_booked"
  | "on_waitlist"
  | "full"
  | "overlap"
  | "consecutive"
  | "rest"
  | "daily_limit"
  | "weekly_limit"
  | "active_limit"
  | "campus_limit"
  | "participants_count"
  | "participant_invalid"
  | "invites"
  | "linked_group"
  | "approval"
  | "standing"
  | "late_window"
  | "linked_group_flag";

export type CheckId = "facility" | "window" | "eligibility" | "standing" | "capacity" | "clash" | "fair_use" | "limits" | "participants" | "group";

export interface RuleResult {
  code: RuleCode;
  check: CheckId;
  severity: "block" | "warn" | "info";
  title: string;
  message: string;
  /** Person the rule is about, if not the booker. */
  personId?: ID;
}

export interface RuleCheck {
  id: CheckId;
  label: string;
  status: "pass" | "fail" | "warn" | "skip";
}

export interface LinkedGroupHit {
  neighborBookingId: ID;
  memberId: ID;
  otherId: ID;
  sharedSessions: number;
}

export interface Evaluation {
  ok: boolean;
  blocking: RuleResult[];
  warnings: RuleResult[];
  checks: RuleCheck[];
  session: SessionInfo | null;
  /** Can the student join the waitlist instead? */
  waitlist: { possible: boolean; reason?: RuleResult; position?: number; entryId?: ID };
  linkedGroup?: LinkedGroupHit;
  /** The student already holds this session. */
  existingBookingId?: ID;
}

export interface BookingRequest {
  facilityId: ID;
  start: string;
  userId: ID;
  /** People the booker invites. They're checked when they accept, not now. */
  participantIds?: ID[];
  /** Re-evaluating an existing booking (e.g. claiming a waitlist offer). */
  ignoreBookingId?: ID;
  /** Evaluate as if joining the waitlist (skip the capacity rule). */
  forWaitlist?: boolean;
}

const CHECK_LABELS: Record<CheckId, () => string> = {
  facility: () => L("Facility open for this session", "المرفق مفتوح في هذا الموعد"),
  window: () => L("Inside the booking window", "داخل فترة الحجز"),
  eligibility: () => L("You’re eligible for this facility", "المرفق متاح لك"),
  standing: () => L("Account in good standing", "حسابك في وضع جيد"),
  capacity: () => L("Space available", "يوجد مكان متاح"),
  clash: () => L("No clash with your other bookings", "لا تعارض مع حجوزاتك الأخرى"),
  fair_use: () => L("Back-to-back & rest-period rules", "قواعد المواعيد المتتالية وفترة الراحة"),
  limits: () => L("Daily, weekly & active limits", "الحدود اليومية والأسبوعية والقادمة"),
  participants: () => L("Players are valid", "اللاعبون مقبولون"),
  group: () => L("Group fairness check", "فحص عدالة المجموعات"),
};

const AUDIENCE_LABEL: Record<string, [string, string]> = {
  undergraduate: ["undergraduate students", "طلاب البكالوريوس"],
  postgraduate: ["postgraduate students", "طلاب الدراسات العليا"],
  faculty_member: ["faculty members", "أعضاء هيئة التدريس"],
  staff: ["university staff", "موظفي الجامعة"],
};

/** Most and fewest people on one booking, including the booker. */
export function peopleLimits(facility: Facility, policy: BookingPolicy): { min: number; max: number } {
  const max = facility.mode === "exclusive" ? Math.max(1, Math.min(policy.participants.max, facility.capacity)) : 1;
  const min = policy.participants.required && facility.mode === "exclusive" ? Math.min(policy.participants.min, max) : 1;
  return { min, max };
}

/**
 * When invited players must have accepted by: the policy's answer window, but
 * no later than booking closes for the session — and never less than ten
 * minutes (or the start, if that's sooner).
 */
export function playersDeadline(now: Date, start: Date, policy: BookingPolicy): Date {
  const answer = addMinutes(now, policy.participants.acceptMinutes ?? 60);
  const closes = addMinutes(start, -policy.window.minLeadMinutes);
  const floor = new Date(Math.min(addMinutes(now, 10).getTime(), start.getTime()));
  const d = answer < closes ? answer : closes;
  return d < floor ? floor : d;
}

const notOnList = () => ({
  title: L("Not on the student list", "غير موجود في قائمة الطلاب"),
  message: L("Your university ID isn’t on the official student list, so you can’t book or join bookings. Please visit the facilities office with your student card.", "رقمك الجامعي غير موجود في قائمة الطلاب الرسمية، لذلك لا يمكنك الحجز أو الانضمام لحجوزات. من فضلك توجّه لمكتب إدارة المرافق ومعك الكارنيه."),
});

interface PersonCheck {
  ix: EngineIndex;
  facility: Facility;
  policy: BookingPolicy;
  scopeName: string;
  slot: { start: Date; end: Date };
  /** ISO start of the session being booked. */
  sessionStart: string;
  ignoreBookingId?: ID;
  /** Daily, weekly, back-to-back and rest rules (clashes are always checked). */
  applyLimits: boolean;
  /** The booker's own booking of this same session is reported as "already booked" instead of a clash. */
  skipSameSession: boolean;
}

/** Clashes, back-to-back chains, rest periods and daily/weekly limits for one person — worded to that person. */
function personRules(c: PersonCheck, pid: ID): RuleResult[] {
  const { ix, facility, policy, scopeName, slot } = c;
  const out: RuleResult[] = [];
  const fail = (r: Omit<RuleResult, "severity">) => out.push({ severity: "block", ...r });
  const start = slot.start.getTime();
  const end = slot.end.getTime();
  const now = ix.now;
  const scopeIds = ix.scopeFacilityIds(facility);
  const adjTolerance = (f: Facility) => Math.max(facility.turnoverMinutes, f.turnoverMinutes) + 5;
  const usage = ix.involvements(pid).filter((b) => b.id !== c.ignoreBookingId && USAGE_STATUSES.has(b.status));

  // Can't be in two places at once.
  const clash = usage.find((b) => overlaps(start, end, new Date(b.start).getTime(), new Date(b.end).getTime()) && !(c.skipSameSession && b.facilityId === facility.id && b.start === c.sessionStart));
  if (clash) {
    const cf = ix.facility(clash.facilityId);
    fail({
      code: "overlap",
      check: "clash",
      title: L("Time clash", "تعارض في المواعيد"),
      message: L(`You already have ${cf?.name ?? "another booking"} at ${fmtRange(clash.start, clash.end)}. You can’t be in two places at once.`, `لديك بالفعل ${cf ? facilityName(cf) : "حجز آخر"} في ${fmtRange(clash.start, clash.end)}. لا يمكنك التواجد في مكانين في نفس الوقت.`),
    });
    return out;
  }
  if (!c.applyLimits) return out;
  const inScope = usage.filter((b) => scopeIds.has(b.facilityId));

  // Back-to-back chain on the same day.
  const sameDay = inScope.filter((b) => isSameDay(new Date(b.start), slot.start)).map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime(), f: ix.facility(b.facilityId) ?? facility, b }));
  const timeline = [...sameDay, { start, end, f: facility, b: null as Booking | null }].sort((a, b) => a.start - b.start);
  const idx = timeline.findIndex((x) => x.b === null);
  let chainStart = idx;
  while (chainStart > 0 && timeline[chainStart].start - timeline[chainStart - 1].end <= adjTolerance(timeline[chainStart - 1].f) * 60000 && timeline[chainStart].start >= timeline[chainStart - 1].end) chainStart--;
  let chainEnd = idx;
  while (chainEnd < timeline.length - 1 && timeline[chainEnd + 1].start - timeline[chainEnd].end <= adjTolerance(timeline[chainEnd + 1].f) * 60000 && timeline[chainEnd + 1].start >= timeline[chainEnd].end) chainEnd++;
  if (chainEnd - chainStart + 1 > policy.fairness.maxConsecutive) {
    const before = idx > chainStart ? timeline[idx - 1] : null;
    const neighbour = before ?? timeline[idx + 1];
    const rel = before ? "immediately before" : "immediately after";
    const allowed = policy.fairness.maxConsecutive;
    fail({
      code: "consecutive",
      check: "fair_use",
      title: L("Back-to-back session", "مواعيد متتالية"),
      message: L(
        `You’re unable to book this session because you already have a booking ${rel} it (${neighbour.f.name}, ${fmtRange(new Date(neighbour.start), new Date(neighbour.end))}). ${allowed === 1 ? "Back-to-back sessions aren’t allowed" : `You can hold at most ${allowed} sessions in a row`} so everyone gets a fair turn — please choose a ${before ? "later" : "earlier"} session.`,
        `لا يمكنك حجز هذا الموعد لأن لديك حجزًا ${before ? "قبله" : "بعده"} مباشرة (${facilityName(neighbour.f)}، ${fmtRange(new Date(neighbour.start), new Date(neighbour.end))}). ${allowed === 1 ? "المواعيد المتتالية غير مسموحة" : `الحد الأقصى للمواعيد المتتالية ${allowed}`} ليحصل الجميع على فرصة عادلة — من فضلك اختر موعدًا ${before ? "لاحقًا" : "أبكر"}.`,
      ),
    });
  } else if (policy.fairness.restMinutes > 0) {
    // Rest period between separate stays.
    const restMs = policy.fairness.restMinutes * 60000;
    const tooClose = sameDay
      .concat(inScope.filter((b) => !isSameDay(new Date(b.start), slot.start)).map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime(), f: ix.facility(b.facilityId) ?? facility, b })))
      .find((x) => {
        const gapAfter = start - x.end; // existing then candidate
        const gapBefore = x.start - end; // candidate then existing
        const tol = adjTolerance(x.f) * 60000;
        return (gapAfter > tol && gapAfter < restMs) || (gapBefore > tol && gapBefore < restMs);
      });
    if (tooClose) {
      const earliest = new Date(tooClose.end + restMs);
      fail({
        code: "rest",
        check: "fair_use",
        title: L("Rest period", "فترة راحة"),
        message:
          tooClose.end <= start
            ? L(`Leave at least ${fmtMinutes(policy.fairness.restMinutes)} between ${scopeName} sessions. Your ${fmtTime(new Date(tooClose.start))} session ends at ${fmtTime(new Date(tooClose.end))}, so the earliest you can start again is ${fmtTime(earliest)}.`, `يجب ترك ${fmtMinutes(policy.fairness.restMinutes)} على الأقل بين مواعيد ${scopeName}. موعدك الساعة ${fmtTime(new Date(tooClose.start))} ينتهي الساعة ${fmtTime(new Date(tooClose.end))}، لذلك أقرب وقت يمكنك البدء فيه هو ${fmtTime(earliest)}.`)
            : L(`Leave at least ${fmtMinutes(policy.fairness.restMinutes)} between ${scopeName} sessions — you already have one at ${fmtTime(new Date(tooClose.start))}.`, `يجب ترك ${fmtMinutes(policy.fairness.restMinutes)} على الأقل بين مواعيد ${scopeName} — لديك موعد بالفعل الساعة ${fmtTime(new Date(tooClose.start))}.`),
      });
    }
  }

  // Daily limit
  const dayCount = inScope.filter((b) => isSameDay(new Date(b.start), slot.start)).length;
  if (dayCount + 1 > policy.limits.perDay) {
    fail({
      code: "daily_limit",
      check: "limits",
      title: L("Daily limit reached", "وصلت للحد اليومي"),
      message: L(
        `You’ve reached the daily limit for ${scopeName} (${policy.limits.perDay} ${policy.limits.perDay === 1 ? "booking" : "bookings"} per day) on ${isSameDay(slot.start, now) ? "today" : fmtDayShort(slot.start)}. You can book again for ${fmtDayShort(addDays(startOfDay(slot.start), 1))}.`,
        `وصلت للحد اليومي في ${scopeName} (${N.booking(policy.limits.perDay)} في اليوم) ${isSameDay(slot.start, now) ? "اليوم" : `يوم ${fmtDayShort(slot.start)}`}. يمكنك الحجز مرة أخرى ليوم ${fmtDayShort(addDays(startOfDay(slot.start), 1))}.`,
      ),
    });
  }

  // Weekly limit
  const wkStart = startOfWeek(slot.start, { weekStartsOn: ix.s.weekStartsOn });
  const wkEnd = addDays(wkStart, 7);
  const weekCount = inScope.filter((b) => {
    const d = new Date(b.start);
    return d >= wkStart && d < wkEnd;
  }).length;
  if (weekCount + 1 > policy.limits.perWeek) {
    fail({
      code: "weekly_limit",
      check: "limits",
      title: L("Weekly limit reached", "وصلت للحد الأسبوعي"),
      message: L(`You’ve used all ${policy.limits.perWeek} ${scopeName} bookings for this week. Your allowance resets on ${fmtDayShort(wkEnd)}.`, `استخدمت كل حجوزاتك في ${scopeName} لهذا الأسبوع (${N.booking(policy.limits.perWeek)}). يتجدد رصيدك يوم ${fmtDayShort(wkEnd)}.`),
    });
  }
  return out;
}

export function evaluateBooking(ix: EngineIndex, req: BookingRequest): Evaluation {
  const results: RuleResult[] = [];
  const skipped = new Set<CheckId>();
  const facility = ix.facility(req.facilityId);
  const booker = ix.user(req.userId);
  const now = ix.now;

  const fail = (r: Omit<RuleResult, "severity"> & { severity?: RuleResult["severity"] }) => results.push({ severity: "block", ...r });

  if (!facility || !booker) {
    return {
      ok: false,
      blocking: [{ code: "not_a_session", check: "facility", severity: "block", title: L("Not available", "غير متاح"), message: L("This facility is no longer available.", "هذا المرفق لم يعد متاحًا.") }],
      warnings: [],
      checks: [],
      session: null,
      waitlist: { possible: false },
    };
  }

  const policy = ix.policyFor(facility);
  const category = ix.category(facility.categoryId);
  const lf = localFacility(facility);
  const fname = lf.name;
  const scopeName = policy.fairness.scope === "category" && category ? facilityName(category) : fname;
  const slot = findSession(facility, req.start);
  if (!slot) {
    return {
      ok: false,
      blocking: [{ code: "not_a_session", check: "facility", severity: "block", title: L("Session not found", "الموعد غير موجود"), message: L("This time isn’t one of the facility’s sessions any more — its schedule may have changed. Please pick a session from the list.", "هذا الوقت لم يعد ضمن مواعيد المرفق — ربما تغيّر الجدول. من فضلك اختر موعدًا من القائمة.") }],
      warnings: [],
      checks: [],
      session: null,
      waitlist: { possible: false },
    };
  }

  const session = describeSession(ix, facility, slot.start, slot.end, { excludeHoldForUserId: req.userId, ignoreBookingId: req.ignoreBookingId });
  const start = slot.start.getTime();
  const participantIds = [...new Set((req.participantIds ?? []).filter((id) => id !== req.userId))];

  /* 1 ─ Facility & session state */
  if (facility.status !== "active") {
    fail({ code: "facility_inactive", check: "facility", title: L("Facility closed", "المرفق مغلق"), message: L(`${fname} is temporarily closed${lf.inactiveReason ? `: ${lf.inactiveReason}` : ""}. Bookings will reopen once it’s back in service.`, `${fname} مغلق مؤقتًا${lf.inactiveReason ? `: ${lf.inactiveReason}` : ""}. سيُعاد فتح الحجز فور عودته للخدمة.`) });
  } else if (!takesBookings(ix, facility)) {
    // Its facility type has been switched off (hidden from Explore) — a saved link or favourite mustn't get round that.
    fail({ code: "facility_inactive", check: "facility", title: L("Not taking bookings", "لا يستقبل حجوزات"), message: L(`${fname} isn’t taking bookings right now.`, `${fname} لا يستقبل حجوزات حاليًا.`) });
  } else if (session.maintenance) {
    const m = session.maintenance;
    fail({ code: "maintenance", check: "facility", title: L("Closed for maintenance", "مغلق للصيانة"), message: L(`${fname} is closed ${fmtRange(m.start, m.end)} on ${fmtDayShort(m.start)} (${m.reason.toLowerCase()}). Please choose another session.`, `${fname} مغلق ${fmtRange(m.start, m.end)} يوم ${fmtDayShort(m.start)} (${m.reason}). من فضلك اختر موعدًا آخر.`) });
  }

  /* 2 ─ Booking window */
  if (session.state === "past") {
    fail({ code: "past", check: "window", title: L("Session has started", "بدأ الموعد"), message: L("This session has already started, so it can no longer be booked.", "بدأ هذا الموعد بالفعل، لذلك لم يعد متاحًا للحجز.") });
  } else if (session.state === "not_open" && session.opensAt) {
    const opens = new Date(session.opensAt);
    fail({ code: "not_open", check: "window", title: L("Not open for booking yet", "الحجز لم يُفتح بعد"), message: L(`Sessions on ${fmtDayShort(req.start)} open for booking on ${fmtDayShort(opens)} at ${fmtTime(opens)}. ${fname} can be booked up to ${policy.window.advanceDays} ${policy.window.advanceDays === 1 ? "day" : "days"} ahead.`, `حجز مواعيد يوم ${fmtDayShort(req.start)} يُفتح يوم ${fmtDayShort(opens)} الساعة ${fmtTime(opens)}. يمكن حجز ${fname} قبل الموعد بـ${N.day(policy.window.advanceDays)} كحد أقصى.`) });
  } else if (start - now.getTime() < policy.window.minLeadMinutes * 60000) {
    fail({ code: "lead_time", check: "window", title: L("Booking has closed", "أُغلق الحجز"), message: L(`Booking closes ${policy.window.minLeadMinutes} minutes before a session starts. Try the next session instead.`, `يُغلق الحجز قبل بداية الموعد بمدة ${fmtMinutes(policy.window.minLeadMinutes)}. جرّب الموعد التالي.`) });
  }

  /* 3 ─ Eligibility */
  if (booker.role === "student" && !ix.onRoster(booker)) fail({ code: "eligibility", check: "eligibility", ...notOnList() });
  const elig = eligibility(facility, booker);
  if (elig) fail({ code: "eligibility", check: "eligibility", title: L("Not eligible", "غير متاح لك"), message: elig });

  /* 4 ─ Account standing */
  if (booker.status !== "active") {
    fail({ code: "account_suspended", check: "standing", title: L("Account suspended", "الحساب موقوف"), message: L("Your account is suspended, so new bookings are paused. Please contact Student Affairs.", "حسابك موقوف، لذلك الحجز الجديد متوقف. من فضلك تواصل مع شؤون الطلاب.") });
  }
  const restriction = ix.activeRestriction(booker.id);
  if (restriction) {
    fail({ code: "restricted", check: "standing", title: L("Booking paused", "الحجز موقوف"), message: L(`Your booking access is paused until ${fmtDayShort(restriction.end)} (${restriction.reason.toLowerCase()}). You can still attend bookings you already have.`, `الحجز موقوف لك حتى ${fmtDayShort(restriction.end)} (${restriction.reason}). يمكنك حضور حجوزاتك الحالية كالمعتاد.`) });
  }

  /* 5 ─ Capacity & duplicates */
  const mine = ix.involvements(booker.id).find((b) => b.id !== req.ignoreBookingId && b.facilityId === facility.id && USAGE_STATUSES.has(b.status) && b.userId === booker.id && b.start === session.start);
  const queue = ix.waitlistFor(facility.id, session.start).filter((w) => w.status === "waiting" || w.status === "offered");
  const myEntry = queue.find((w) => w.userId === booker.id);
  let existingBookingId: ID | undefined;
  if (mine) {
    existingBookingId = mine.id;
    fail({ code: "already_booked", check: "capacity", title: L("Already booked", "محجوز بالفعل"), message: L("You’ve already booked this session. You’ll find it in My Bookings.", "لقد حجزت هذا الموعد بالفعل. ستجده في حجوزاتي.") });
  } else if (!req.forWaitlist && session.remaining <= 0 && session.state !== "past") {
    fail({ code: "full", check: "capacity", title: L("Fully booked", "مكتمل"), message: policy.waitlist.enabled ? L("This session is fully booked. Join the waitlist and we’ll notify you the moment a spot opens.", "هذا الموعد مكتمل. انضم لقائمة الانتظار وسنُبلغك فور توفر مكان.") : L("This session is fully booked. Please choose another session.", "هذا الموعد مكتمل. من فضلك اختر موعدًا آخر.") });
  }

  /* 6 ─ The booker: clashes, back-to-back, rest, limits. Invited players are checked when they accept. */
  results.push(...personRules({ ix, facility, policy, scopeName, slot, sessionStart: session.start, ignoreBookingId: req.ignoreBookingId, applyLimits: true, skipSameSession: true }, booker.id));

  // Holding limits apply to the booker only.
  const upcoming = ix.involvements(booker.id).filter((b) => b.userId === booker.id && b.id !== req.ignoreBookingId && UPCOMING_STATUSES.has(b.status) && new Date(b.end) > now);
  const upcomingInScope = upcoming.filter((b) => ix.scopeFacilityIds(facility).has(b.facilityId));
  if (!mine && upcomingInScope.length >= policy.limits.maxActive) {
    fail({ code: "active_limit", check: "limits", title: L("Too many upcoming bookings", "حجوزات قادمة كثيرة"), message: L(`You already have ${upcomingInScope.length} upcoming ${scopeName} ${upcomingInScope.length === 1 ? "booking" : "bookings"} — the most you can hold at once. Attend or cancel one to book another.`, `وصلت للحد الأقصى من الحجوزات القادمة في ${scopeName} (${upcomingInScope.length}). احضر أو ألغِ أحدها لتحجز غيره.`) });
  } else if (!mine && upcoming.length >= policy.campus.maxActiveBookings) {
    fail({ code: "campus_limit", check: "limits", title: L("Campus booking limit", "حد الحجز في الحرم"), message: L(`You have ${upcoming.length} upcoming bookings across campus, the maximum at one time. Attend or cancel one to book something new.`, `وصلت للحد الأقصى من الحجوزات القادمة في الحرم كله (${upcoming.length}). احضر أو ألغِ أحدها لتحجز شيئًا جديدًا.`) });
  }

  /* 7 ─ Players: how many, and whether they're real students. Everyone else's limits are checked when they accept. */
  const { min: minPeople, max: maxPeople } = peopleLimits(facility, policy);
  const total = 1 + participantIds.length;
  if (!req.forWaitlist && total < minPeople) {
    fail({ code: "participants_count", check: "participants", title: L("Add your players", "أضف اللاعبين"), message: L(`${fname} needs at least ${minPeople} people — you plus ${minPeople - 1} ${minPeople - 1 === 1 ? "other" : "others"}. Invite ${minPeople - total} more by name or university ID.`, `يحتاج ${fname} إلى ${N.person(minPeople)} على الأقل بما فيهم أنت. ادعُ ${arCount(minPeople - total, "شخصًا واحدًا آخر", "شخصين آخرين", "أشخاص آخرين", "شخصًا آخر")} بالاسم أو الرقم الجامعي.`) });
  } else if (total > maxPeople) {
    fail({ code: "participants_count", check: "participants", title: L("Too many people", "العدد أكبر من المسموح"), message: maxPeople === 1 ? L(`${fname} is booked by one person — you can’t add others.`, `يُحجز ${fname} لشخص واحد — لا يمكنك إضافة آخرين.`) : L(`${fname} allows up to ${maxPeople} people per booking.`, `يسمح ${fname} بحد أقصى ${N.person(maxPeople)} في الحجز الواحد.`) });
  }
  for (const pid of participantIds) {
    const u = ix.user(pid);
    if (!u || u.role !== "student" || u.status !== "active" || !ix.onRoster(u)) {
      fail({ code: "participant_invalid", check: "participants", personId: pid, title: L("Can’t invite", "لا يمكن الدعوة"), message: L("One of the people you added isn’t an active student.", "أحد الأشخاص الذين أضفتهم ليس طالبًا نشطًا.") });
    }
  }
  if (participantIds.length > 0) {
    const needed = minPeople - 1;
    const deadline = playersDeadline(now, slot.start, policy);
    const by = isSameDay(deadline, now) ? fmtTime(deadline) : `${fmtDayShort(deadline)}${L(", ", "، ")}${fmtTime(deadline)}`;
    results.push({
      code: "invites",
      check: "participants",
      severity: "info",
      title: L("Your players accept on their phones", "اللاعبون يوافقون من موبايلاتهم"),
      message:
        needed > 0
          ? L(`Everyone you add gets an invitation. The booking is confirmed once ${needed} of them ${needed === 1 ? "accepts" : "accept"} — by ${by}. If too few accept in time, it’s cancelled and the session reopens for others.`, `كل من تضيفه تصله دعوة. يتأكد الحجز عندما ${needed === 1 ? "يوافق واحد منهم" : `يوافق ${N.person(needed)} منهم`} — قبل ${by}. إذا لم يوافق العدد الكافي في الوقت المحدد، يُلغى الحجز ويُتاح الموعد لغيرك.`)
          : L("Everyone you add gets an invitation and joins the booking when they accept.", "كل من تضيفه تصله دعوة وينضم للحجز عندما يوافق."),
    });
  } else if (minPeople <= 1) {
    skipped.add("participants");
  }

  /* 8 ─ Linked groups (different accounts, same group) */
  let linkedGroup: LinkedGroupHit | undefined;
  const lg = policy.fairness.linkedGroups;
  if (lg.enabled && facility.mode === "exclusive") {
    linkedGroup = findLinkedNeighbour(ix, facility, policy, start, slot.end.getTime(), [booker.id, ...participantIds], req.ignoreBookingId);
    if (linkedGroup) {
      if (lg.action === "block") {
        fail({
          code: "linked_group",
          check: "group",
          title: L("Same group, back-to-back", "نفس المجموعة، مواعيد متتالية"),
          message: L(
            `This session is right next to one booked by ${linkedGroup.memberId === booker.id ? "a student you often play with" : "a regular teammate of someone on your list"}. To keep ${scopeName} fair, the same group can’t hold back-to-back sessions — even from different accounts. Please choose a session that isn’t right before or after theirs.`,
            `هذا الموعد ملاصق لموعد حجزه ${linkedGroup.memberId === booker.id ? "طالب تلعب معه كثيرًا" : "زميل دائم لأحد الموجودين في قائمتك"}. للحفاظ على العدالة في ${scopeName}، لا يمكن لنفس المجموعة حجز مواعيد متتالية — حتى من حسابات مختلفة. من فضلك اختر موعدًا ليس قبل موعدهم أو بعده مباشرة.`,
          ),
        });
      } else {
        results.push({ code: "linked_group_flag", check: "group", severity: "warn", title: L("This booking will be reviewed", "سيتم مراجعة هذا الحجز"), message: L("Back-to-back sessions by students who regularly play together are reviewed by the facilities office. Repeated patterns may lead to a warning.", "المواعيد المتتالية لطلاب يلعبون معًا باستمرار يراجعها مكتب إدارة المرافق. تكرار هذا النمط قد يؤدي إلى تنبيه.") });
      }
    }
  } else {
    skipped.add("group");
  }

  /* 9 ─ Informational warnings */
  if (policy.approval.required) {
    results.push({ code: "approval", check: "facility", severity: "info", title: L("Needs approval", "يحتاج موافقة"), message: L(`${fname} requests are reviewed by staff. Your booking stays pending until it’s approved — usually within one working day.`, `طلبات ${fname} يراجعها الموظفون. يبقى حجزك معلّقًا حتى الموافقة عليه — عادةً خلال يوم عمل واحد.`) });
  }
  const standing = computeStanding(ix, booker.id);
  if (!restriction && standing.strikes.length > 0) {
    const nxt = standing.next;
    results.push({
      code: "standing",
      check: "standing",
      severity: "warn",
      title: standing.level === "final_warning" ? L("Final warning", "إنذار أخير") : L("Missed sessions", "مواعيد فائتة"),
      message: L(
        `You have ${standing.strikes.length} missed ${standing.strikes.length === 1 ? "session" : "sessions"} on record.${nxt ? ` At ${nxt.strikes}, ${nxt.action === "restrict" ? `booking is paused for ${nxt.restrictDays} days` : nxt.action === "final_warning" ? "you’ll receive a final warning" : "you’ll receive a warning"}.` : ""} Remember to check in or cancel in time.`,
        `مسجّل عليك ${arCount(standing.strikes.length, "موعد واحد فائت", "موعدان فائتان", "مواعيد فائتة", "موعدًا فائتًا")}.${nxt ? ` عند الوصول إلى ${N.strike(nxt.strikes)} ${nxt.action === "restrict" ? `يتوقف الحجز لمدة ${N.day(nxt.restrictDays ?? 7)}` : nxt.action === "final_warning" ? "ستحصل على إنذار أخير" : "ستحصل على تنبيه"}.` : ""} تذكّر تسجيل الحضور أو الإلغاء في الوقت المناسب.`,
      ),
    });
  }
  if (start - now.getTime() < policy.cancellation.freeUntilMinutes * 60000 && start > now.getTime()) {
    results.push({ code: "late_window", check: "window", severity: "info", title: L("Inside the late-cancellation window", "داخل فترة الإلغاء المتأخر"), message: L(`This session starts within ${fmtMinutes(policy.cancellation.freeUntilMinutes)}, so cancelling it${policy.cancellation.lateCountsAsStrike ? " would count as a missed session" : " will be recorded as a late cancellation"}.`, `يبدأ هذا الموعد خلال ${fmtMinutes(policy.cancellation.freeUntilMinutes)}، لذلك إلغاؤه ${policy.cancellation.lateCountsAsStrike ? "سيُحتسب كموعد فائت" : "سيُسجّل كإلغاء متأخر"}.`) });
  }

  const blocking = results.filter((r) => r.severity === "block");
  const warnings = results.filter((r) => r.severity !== "block");

  /* Waitlist eligibility — every rule except capacity must pass. */
  let waitlist: Evaluation["waitlist"] = { possible: false };
  if (myEntry) {
    waitlist = { possible: false, position: queue.findIndex((w) => w.id === myEntry.id) + 1, entryId: myEntry.id };
  } else if (blocking.length > 0 && blocking.every((b) => b.code === "full" || b.code === "participants_count")) {
    const myWaitlists = ix.s.waitlist.filter((w) => w.userId === booker.id && (w.status === "waiting" || w.status === "offered") && new Date(w.start) > now).length;
    if (!policy.waitlist.enabled) waitlist = { possible: false, reason: { code: "full", check: "capacity", severity: "block", title: L("No waitlist", "لا توجد قائمة انتظار"), message: L("This facility doesn’t use a waitlist.", "هذا المرفق لا يستخدم قائمة انتظار.") } };
    else if (queue.length >= policy.waitlist.maxPerSession) waitlist = { possible: false, reason: { code: "full", check: "capacity", severity: "block", title: L("Waitlist full", "قائمة الانتظار ممتلئة"), message: L(`The waitlist for this session is full (${policy.waitlist.maxPerSession} students).`, `قائمة الانتظار لهذا الموعد ممتلئة (${N.student(policy.waitlist.maxPerSession)}).`) } };
    else if (myWaitlists >= policy.campus.maxActiveWaitlists) waitlist = { possible: false, reason: { code: "campus_limit", check: "limits", severity: "block", title: L("Waitlist limit", "حد قوائم الانتظار"), message: L(`You’re already on ${myWaitlists} waitlists — the most at once. Leave one to join another.`, `أنت بالفعل في ${arCount(myWaitlists, "قائمة انتظار واحدة", "قائمتي انتظار", "قوائم انتظار", "قائمة انتظار")} — وهو الحد الأقصى. غادر إحداها لتنضم لأخرى.`) } };
    else if (blocking.some((b) => b.code === "full")) waitlist = { possible: true, position: queue.length + 1 };
  }

  const checks: RuleCheck[] = (Object.keys(CHECK_LABELS) as CheckId[]).map((id) => {
    if (skipped.has(id)) return { id, label: CHECK_LABELS[id](), status: "skip" };
    const rs = results.filter((r) => r.check === id);
    const status: RuleCheck["status"] = rs.some((r) => r.severity === "block") ? "fail" : rs.some((r) => r.severity === "warn") ? "warn" : "pass";
    return { id, label: CHECK_LABELS[id](), status };
  });

  return { ok: blocking.length === 0, blocking, warnings, checks, session, waitlist, linkedGroup, existingBookingId };
}

export interface JoinEvaluation {
  ok: boolean;
  blocking: RuleResult[];
}

/**
 * Can this invited student accept a place on the booking? Their own standing,
 * clashes and fair-use limits are checked now — the booker never sees why not.
 */
export function evaluateJoin(ix: EngineIndex, booking: Booking, userId: ID): JoinEvaluation {
  const facility = ix.facility(booking.facilityId);
  const user = ix.user(userId);
  const blocking: RuleResult[] = [];
  const fail = (r: Omit<RuleResult, "severity">) => blocking.push({ severity: "block", ...r });
  if (!facility || !user) {
    return { ok: false, blocking: [{ code: "not_a_session", check: "facility", severity: "block", title: L("Not available", "غير متاح"), message: L("This booking is no longer available.", "هذا الحجز لم يعد متاحًا.") }] };
  }
  const policy = ix.policyFor(facility);
  const category = ix.category(facility.categoryId);
  const scopeName = policy.fairness.scope === "category" && category ? facilityName(category) : facilityName(facility);
  const start = new Date(booking.start);
  const end = new Date(booking.end);

  if (!UPCOMING_STATUSES.has(booking.status) || start <= ix.now) {
    fail({ code: "past", check: "window", title: L("Too late to join", "فات وقت الانضمام"), message: L("This booking has already started, ended or been cancelled.", "هذا الحجز بدأ أو انتهى أو تم إلغاؤه.") });
    return { ok: false, blocking };
  }
  if (user.status !== "active") {
    fail({ code: "account_suspended", check: "standing", title: L("Account suspended", "الحساب موقوف"), message: L("Your account is suspended, so you can’t join bookings. Please contact Student Affairs.", "حسابك موقوف، لذلك لا يمكنك الانضمام لحجوزات. من فضلك تواصل مع شؤون الطلاب.") });
  }
  const restriction = ix.activeRestriction(userId);
  if (restriction) {
    fail({ code: "restricted", check: "standing", title: L("Booking paused", "الحجز موقوف"), message: L(`Your booking access is paused until ${fmtDayShort(restriction.end)} (${restriction.reason.toLowerCase()}), so you can’t join new bookings.`, `الحجز موقوف لك حتى ${fmtDayShort(restriction.end)} (${restriction.reason})، لذلك لا يمكنك الانضمام لحجوزات جديدة.`) });
  }
  if (user.role === "student" && !ix.onRoster(user)) fail({ code: "eligibility", check: "eligibility", ...notOnList() });
  const elig = eligibility(facility, user);
  if (elig) fail({ code: "eligibility", check: "eligibility", title: L("Not eligible", "غير متاح لك"), message: elig });

  const other = ix.involvements(userId).find((b) => b.id !== booking.id && b.facilityId === facility.id && b.start === booking.start && USAGE_STATUSES.has(b.status));
  if (other) {
    fail({ code: "already_booked", check: "capacity", title: L("Already booked", "محجوز بالفعل"), message: L("You’re already on another booking for this session.", "أنت بالفعل في حجز آخر لنفس الموعد.") });
  } else {
    blocking.push(...personRules({ ix, facility, policy, scopeName, slot: { start, end }, sessionStart: booking.start, ignoreBookingId: booking.id, applyLimits: policy.fairness.applyToParticipants, skipSameSession: false }, userId));
  }
  if (playersOf(booking).length + 1 > peopleLimits(facility, policy).max) {
    fail({ code: "participants_count", check: "participants", title: L("Booking is full", "الحجز مكتمل"), message: L("This booking already has as many players as the facility allows.", "هذا الحجز وصل للحد الأقصى من اللاعبين المسموح به في المرفق.") });
  }
  return { ok: blocking.length === 0, blocking };
}

export function eligibility(facility: Facility, user: User): string | null {
  const a = facility.access;
  const audience = user.audience ?? (user.role === "student" ? "undergraduate" : "staff");
  const name = facilityName(facility);
  if (!a.audiences.includes(audience)) {
    return L(`${name} is open to ${a.audiences.map((x) => AUDIENCE_LABEL[x]?.[0] ?? x).join(" and ")} only.`, `${name} مخصص فقط لـ${a.audiences.map((x) => AUDIENCE_LABEL[x]?.[1] ?? x).join(" و")}.`);
  }
  if (a.faculties && a.faculties.length > 0 && user.faculty && !a.faculties.includes(user.faculty)) {
    return L(`${name} is reserved for students of ${listJoin(a.faculties)}. If you need access for a course, ask your instructor to request it.`, `${name} مخصص لطلاب ${listJoin(a.faculties)}. إذا كنت تحتاجه لمادة دراسية، اطلب من المحاضر تقديم طلب.`);
  }
  if (a.minYear && user.year && user.year < a.minYear) {
    return L(`${name} is open to students from year ${a.minYear} onwards.`, `${name} متاح للطلاب من السنة ${a.minYear} فما فوق.`);
  }
  return null;
}

function listJoin(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return L(`${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`, `${xs.slice(0, -1).join("، ")} و${xs[xs.length - 1]}`);
}

/**
 * Linked-group detection.
 * Two students are "linked" if they have played on at least N bookings together
 * in the look-back window. If anyone on the new booking is linked to anyone on
 * an adjacent booking in scope, the group is trying to extend its time using a
 * different account.
 */
export function findLinkedNeighbour(ix: EngineIndex, facility: Facility, policy: BookingPolicy, start: number, end: number, members: ID[], ignoreBookingId?: ID): LinkedGroupHit | undefined {
  const lg = policy.fairness.linkedGroups;
  const scopeIds = ix.scopeFacilityIds(facility);
  const tol = (facility.turnoverMinutes + 5) * 60000;
  const memberSet = new Set(members);

  const neighbours: Booking[] = [];
  for (const fid of scopeIds) {
    for (const b of ix.bookingsForFacility(fid)) {
      if (b.id === ignoreBookingId || !USAGE_STATUSES.has(b.status)) continue;
      const bs = new Date(b.start).getTime();
      const be = new Date(b.end).getTime();
      const adjacentBefore = start - be >= 0 && start - be <= tol;
      const adjacentAfter = bs - end >= 0 && bs - end <= tol;
      if (!adjacentBefore && !adjacentAfter) continue;
      if (playersOf(b).some((id) => memberSet.has(id))) continue; // same person — handled by back-to-back rule
      neighbours.push(b);
    }
  }
  if (neighbours.length === 0) return undefined;

  const since = addMinutes(ix.now, -lg.lookbackDays * 1440).getTime();
  const sharedCount = (a: ID, b: ID) => {
    let n = 0;
    for (const bk of ix.involvements(a)) {
      if (!USAGE_STATUSES.has(bk.status) || bk.status === "NO_SHOW") continue;
      if (new Date(bk.start).getTime() < since || bk.id === ignoreBookingId) continue;
      if (bk.userId === b || bk.participants.some((p) => p.userId === b && hasJoined(p))) n++;
    }
    return n;
  };

  let best: LinkedGroupHit | undefined;
  for (const nb of neighbours) {
    for (const m of members) {
      for (const o of playersOf(nb)) {
        const n = sharedCount(m, o);
        if (n >= lg.minSharedSessions && (!best || n > best.sharedSessions)) best = { neighborBookingId: nb.id, memberId: m, otherId: o, sharedSessions: n };
      }
    }
  }
  return best;
}

/** Plain-language status of a single slot for the viewer — used by the availability grid. */
export type SlotStatus = "mine" | "waitlisted" | "available" | "limited" | "waitlist" | "full" | "blocked" | "maintenance" | "closed" | "past" | "not_open";

export function slotStatus(ev: Evaluation): SlotStatus {
  const s = ev.session;
  if (!s) return "closed";
  if (ev.existingBookingId) return "mine";
  if (ev.waitlist.position && ev.waitlist.entryId) return "waitlisted";
  if (s.state === "past") return "past";
  if (s.state === "maintenance") return "maintenance";
  if (s.state === "not_open") return "not_open";
  if (s.state === "closed") return "closed";
  if (ev.ok) return s.state === "limited" ? "limited" : "available";
  // Full — can the viewer queue?
  if (ev.blocking.some((b) => b.code === "full")) {
    const others = ev.blocking.filter((b) => b.code !== "full" && b.code !== "participants_count");
    if (others.length === 0) return ev.waitlist.possible ? "waitlist" : "full";
    return "full";
  }
  // Only missing participants — still bookable once they're added.
  if (ev.blocking.every((b) => b.code === "participants_count")) return s.state === "limited" ? "limited" : "available";
  return "blocked";
}
