import { addDays, addMinutes, isSameDay, startOfDay, startOfWeek } from "date-fns";
import { fmtMinutes } from "../policy";
import { facilityName, localFacility } from "../localize";
import { L, N, arCount } from "@/i18n/lang";
import { fmtRange, fmtTime, fmtDayShort, overlaps } from "@/lib/time";
import type { Booking, BookingPolicy, Facility, ID, User } from "../types";
import { describeSession, findSession, type SessionInfo } from "./sessions";
import { EngineIndex, UPCOMING_STATUSES, USAGE_STATUSES } from "./snapshot";
import { computeStanding } from "./standing";

/**
 * The booking rule pipeline.
 *
 * `evaluateBooking` is a pure function over an EngineSnapshot. The UI calls it
 * to explain every slot before the student taps it; the API calls the very same
 * function again inside a lock at commit time, so a stale screen can never
 * create a booking the rules would reject.
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
  participants: () => L("Participants are valid", "المشاركون مقبولون"),
  group: () => L("Group fairness check", "فحص عدالة المجموعات"),
};

const AUDIENCE_LABEL: Record<string, [string, string]> = {
  undergraduate: ["undergraduate students", "طلاب البكالوريوس"],
  postgraduate: ["postgraduate students", "طلاب الدراسات العليا"],
  faculty_member: ["faculty members", "أعضاء هيئة التدريس"],
  staff: ["university staff", "موظفي الجامعة"],
};

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
  const end = slot.end.getTime();
  const participantIds = [...new Set((req.participantIds ?? []).filter((id) => id !== req.userId))];

  /* 1 ─ Facility & session state */
  if (facility.status !== "active") {
    fail({ code: "facility_inactive", check: "facility", title: L("Facility closed", "المرفق مغلق"), message: L(`${fname} is temporarily closed${lf.inactiveReason ? `: ${lf.inactiveReason}` : ""}. Bookings will reopen once it’s back in service.`, `${fname} مغلق مؤقتًا${lf.inactiveReason ? `: ${lf.inactiveReason}` : ""}. سيُعاد فتح الحجز فور عودته للخدمة.`) });
  } else if (session.maintenance) {
    const m = session.maintenance;
    fail({ code: "maintenance", check: "facility", title: L("Closed for maintenance", "مغلق للصيانة"), message: L(`${fname} is closed ${fmtRange(m.start, m.end)} on ${fmtDayShort(m.start)} (${m.reason.toLowerCase()}). Please choose another session.`, `${fname} مغلق ${fmtRange(m.start, m.end)} يوم ${fmtDayShort(m.start)} (${m.reason}). من فضلك اختر موعدًا آخر.`) });
  }

  /* 2 ─ Booking window */
  if (session.state === "past") {
    fail({ code: "past", check: "window", title: L("Session has started", "بدأ الموعد"), message: L("This session has already started, so it can no longer be booked.", "بدأ هذا الموعد بالفعل، لذلك لم يعد متاحًا للحجز.") });
  } else if (session.state === "not_open" && session.opensAt) {
    fail({ code: "not_open", check: "window", title: L("Not open for booking yet", "الحجز لم يُفتح بعد"), message: L(`Sessions on ${fmtDayShort(req.start)} open for booking on ${fmtDayShort(session.opensAt)}. ${fname} can be booked up to ${policy.window.advanceDays} ${policy.window.advanceDays === 1 ? "day" : "days"} ahead.`, `حجز مواعيد يوم ${fmtDayShort(req.start)} يُفتح يوم ${fmtDayShort(session.opensAt)}. يمكن حجز ${fname} قبل الموعد بـ${N.day(policy.window.advanceDays)} كحد أقصى.`) });
  } else if (start - now.getTime() < policy.window.minLeadMinutes * 60000) {
    fail({ code: "lead_time", check: "window", title: L("Booking has closed", "أُغلق الحجز"), message: L(`Booking closes ${policy.window.minLeadMinutes} minutes before a session starts. Try the next session instead.`, `يُغلق الحجز قبل بداية الموعد بمدة ${fmtMinutes(policy.window.minLeadMinutes)}. جرّب الموعد التالي.`) });
  }

  /* 3 ─ Eligibility */
  const elig = eligibility(facility, booker);
  if (elig) fail({ code: "eligibility", check: "eligibility", title: L("Not eligible", "غير متاح لك"), message: elig });

  /* 4 ─ Account standing */
  if (booker.status === "suspended") {
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

  /* 6 ─ Everyone involved: clashes, back-to-back, rest, limits */
  const people: ID[] = [booker.id, ...(policy.fairness.applyToParticipants ? participantIds : [])];
  const scopeIds = ix.scopeFacilityIds(facility);
  const adjTolerance = (f: Facility) => Math.max(facility.turnoverMinutes, f.turnoverMinutes) + 5;

  for (const pid of [booker.id, ...participantIds]) {
    const who = pid === booker.id ? L("You", "أنت") : ix.user(pid)?.name ?? L("A participant", "أحد المشاركين");
    const usage = ix.involvements(pid).filter((b) => b.id !== req.ignoreBookingId && USAGE_STATUSES.has(b.status));

    // Can't be in two places at once — applies to everyone listed.
    const clash = usage.find((b) => overlaps(start, end, new Date(b.start).getTime(), new Date(b.end).getTime()) && !(b.facilityId === facility.id && b.start === session.start && pid === booker.id));
    if (clash && !(mine && clash.id === mine.id)) {
      const cf = ix.facility(clash.facilityId);
      fail({
        code: "overlap",
        check: "clash",
        personId: pid === booker.id ? undefined : pid,
        title: L("Time clash", "تعارض في المواعيد"),
        message:
          pid === booker.id
            ? L(`You already have ${cf?.name ?? "another booking"} at ${fmtRange(clash.start, clash.end)}. You can’t be in two places at once.`, `لديك بالفعل ${cf ? facilityName(cf) : "حجز آخر"} في ${fmtRange(clash.start, clash.end)}. لا يمكنك التواجد في مكانين في نفس الوقت.`)
            : L(`${who} is already booked elsewhere at this time.`, `لدى ${who} حجز آخر في نفس الوقت.`),
      });
      continue;
    }

    if (!people.includes(pid)) continue;
    const inScope = usage.filter((b) => scopeIds.has(b.facilityId));

    // Back-to-back chain on the same day.
    const sameDay = inScope.filter((b) => isSameDay(new Date(b.start), slot.start)).map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime(), f: ix.facility(b.facilityId) ?? facility, b }));
    const timeline = [...sameDay, { start, end, f: facility, b: null as Booking | null }].sort((a, b) => a.start - b.start);
    const idx = timeline.findIndex((x) => x.b === null);
    let chainStart = idx;
    while (chainStart > 0 && timeline[chainStart].start - timeline[chainStart - 1].end <= adjTolerance(timeline[chainStart - 1].f) * 60000 && timeline[chainStart].start >= timeline[chainStart - 1].end) chainStart--;
    let chainEnd = idx;
    while (chainEnd < timeline.length - 1 && timeline[chainEnd + 1].start - timeline[chainEnd].end <= adjTolerance(timeline[chainEnd + 1].f) * 60000 && timeline[chainEnd + 1].start >= timeline[chainEnd].end) chainEnd++;
    const chainLength = chainEnd - chainStart + 1;
    if (chainLength > policy.fairness.maxConsecutive) {
      const before = idx > chainStart ? timeline[idx - 1] : null;
      const after = idx < chainEnd ? timeline[idx + 1] : null;
      const neighbour = before ?? after!;
      const rel = before ? "immediately before" : "immediately after";
      const allowed = policy.fairness.maxConsecutive;
      fail({
        code: "consecutive",
        check: "fair_use",
        personId: pid === booker.id ? undefined : pid,
        title: L("Back-to-back session", "مواعيد متتالية"),
        message:
          pid === booker.id
            ? L(
                `You’re unable to book this session because you already have a booking ${rel} it (${neighbour.f.name}, ${fmtRange(new Date(neighbour.start), new Date(neighbour.end))}). ${allowed === 1 ? "Back-to-back sessions aren’t allowed" : `You can hold at most ${allowed} sessions in a row`} so everyone gets a fair turn — please choose a ${before ? "later" : "earlier"} session.`,
                `لا يمكنك حجز هذا الموعد لأن لديك حجزًا ${before ? "قبله" : "بعده"} مباشرة (${facilityName(neighbour.f)}، ${fmtRange(new Date(neighbour.start), new Date(neighbour.end))}). ${allowed === 1 ? "المواعيد المتتالية غير مسموحة" : `الحد الأقصى للمواعيد المتتالية ${allowed}`} ليحصل الجميع على فرصة عادلة — من فضلك اختر موعدًا ${before ? "لاحقًا" : "أبكر"}.`,
              )
            : L(`${who} already has a session ${rel} this one, so they can’t be added to a back-to-back booking.`, `لدى ${who} موعد ${before ? "قبل" : "بعد"} هذا الموعد مباشرة، لذلك لا يمكن إضافته لحجز متتالٍ.`),
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
        const isBefore = tooClose.end <= start;
        fail({
          code: "rest",
          check: "fair_use",
          personId: pid === booker.id ? undefined : pid,
          title: L("Rest period", "فترة راحة"),
          message:
            pid === booker.id
              ? isBefore
                ? L(`Leave at least ${fmtMinutes(policy.fairness.restMinutes)} between ${scopeName} sessions. Your ${fmtTime(new Date(tooClose.start))} session ends at ${fmtTime(new Date(tooClose.end))}, so the earliest you can start again is ${fmtTime(earliest)}.`, `يجب ترك ${fmtMinutes(policy.fairness.restMinutes)} على الأقل بين مواعيد ${scopeName}. موعدك الساعة ${fmtTime(new Date(tooClose.start))} ينتهي الساعة ${fmtTime(new Date(tooClose.end))}، لذلك أقرب وقت يمكنك البدء فيه هو ${fmtTime(earliest)}.`)
                : L(`Leave at least ${fmtMinutes(policy.fairness.restMinutes)} between ${scopeName} sessions — you already have one at ${fmtTime(new Date(tooClose.start))}.`, `يجب ترك ${fmtMinutes(policy.fairness.restMinutes)} على الأقل بين مواعيد ${scopeName} — لديك موعد بالفعل الساعة ${fmtTime(new Date(tooClose.start))}.`)
              : L(`${who} has another ${scopeName} session too close to this one (a ${fmtMinutes(policy.fairness.restMinutes)} rest period applies).`, `لدى ${who} موعد آخر في ${scopeName} قريب جدًا من هذا الموعد (يجب ترك فترة راحة ${fmtMinutes(policy.fairness.restMinutes)}).`),
        });
      }
    }

    // Daily limit
    const dayCount = inScope.filter((b) => isSameDay(new Date(b.start), slot.start)).length;
    if (dayCount + 1 > policy.limits.perDay) {
      fail({
        code: "daily_limit",
        check: "limits",
        personId: pid === booker.id ? undefined : pid,
        title: L("Daily limit reached", "وصلت للحد اليومي"),
        message:
          pid === booker.id
            ? L(
                `You’ve reached the daily limit for ${scopeName} (${policy.limits.perDay} ${policy.limits.perDay === 1 ? "booking" : "bookings"} per day) on ${isSameDay(slot.start, now) ? "today" : fmtDayShort(slot.start)}. You can book again for ${fmtDayShort(addDays(startOfDay(slot.start), 1))}.`,
                `وصلت للحد اليومي في ${scopeName} (${N.booking(policy.limits.perDay)} في اليوم) ${isSameDay(slot.start, now) ? "اليوم" : `يوم ${fmtDayShort(slot.start)}`}. يمكنك الحجز مرة أخرى ليوم ${fmtDayShort(addDays(startOfDay(slot.start), 1))}.`,
              )
            : L(`${who} has already reached the daily limit for ${scopeName}.`, `استُنفد الحد اليومي لـ${who} في ${scopeName}.`),
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
        personId: pid === booker.id ? undefined : pid,
        title: L("Weekly limit reached", "وصلت للحد الأسبوعي"),
        message:
          pid === booker.id
            ? L(`You’ve used all ${policy.limits.perWeek} ${scopeName} bookings for this week. Your allowance resets on ${fmtDayShort(wkEnd)}.`, `استخدمت كل حجوزاتك في ${scopeName} لهذا الأسبوع (${N.booking(policy.limits.perWeek)}). يتجدد رصيدك يوم ${fmtDayShort(wkEnd)}.`)
            : L(`${who} has already used this week’s ${scopeName} allowance.`, `استُنفد رصيد ${who} الأسبوعي في ${scopeName}.`),
      });
    }
  }

  // Holding limits apply to the booker only.
  const upcoming = ix.involvements(booker.id).filter((b) => b.userId === booker.id && b.id !== req.ignoreBookingId && UPCOMING_STATUSES.has(b.status) && new Date(b.end) > now);
  const upcomingInScope = upcoming.filter((b) => scopeIds.has(b.facilityId));
  if (!mine && upcomingInScope.length >= policy.limits.maxActive) {
    fail({ code: "active_limit", check: "limits", title: L("Too many upcoming bookings", "حجوزات قادمة كثيرة"), message: L(`You already have ${upcomingInScope.length} upcoming ${scopeName} ${upcomingInScope.length === 1 ? "booking" : "bookings"} — the most you can hold at once. Attend or cancel one to book another.`, `وصلت للحد الأقصى من الحجوزات القادمة في ${scopeName} (${upcomingInScope.length}). احضر أو ألغِ أحدها لتحجز غيره.`) });
  } else if (!mine && upcoming.length >= policy.campus.maxActiveBookings) {
    fail({ code: "campus_limit", check: "limits", title: L("Campus booking limit", "حد الحجز في الحرم"), message: L(`You have ${upcoming.length} upcoming bookings across campus, the maximum at one time. Attend or cancel one to book something new.`, `وصلت للحد الأقصى من الحجوزات القادمة في الحرم كله (${upcoming.length}). احضر أو ألغِ أحدها لتحجز شيئًا جديدًا.`) });
  }

  /* 7 ─ Participants */
  if (policy.participants.required && facility.mode === "exclusive") {
    const total = 1 + participantIds.length;
    const max = Math.min(policy.participants.max, facility.capacity);
    if (!req.forWaitlist && total < policy.participants.min) {
      fail({ code: "participants_count", check: "participants", title: L("Add your players", "أضف اللاعبين"), message: L(`${fname} needs at least ${policy.participants.min} people listed — you plus ${policy.participants.min - 1} ${policy.participants.min - 1 === 1 ? "other" : "others"}. Add ${policy.participants.min - total} more by university ID.`, `يحتاج ${fname} إلى ${N.person(policy.participants.min)} على الأقل بما فيهم أنت. أضف ${arCount(policy.participants.min - total, "شخصًا واحدًا آخر", "شخصين آخرين", "أشخاص آخرين", "شخصًا آخر")} بالرقم الجامعي.`) });
    } else if (total > max) {
      fail({ code: "participants_count", check: "participants", title: L("Too many people", "العدد أكبر من المسموح"), message: L(`${fname} allows up to ${max} people per booking.`, `يسمح ${fname} بحد أقصى ${N.person(max)} في الحجز الواحد.`) });
    }
    for (const pid of participantIds) {
      const u = ix.user(pid);
      if (!u || u.role !== "student") {
        fail({ code: "participant_invalid", check: "participants", personId: pid, title: L("Unknown participant", "مشارك غير معروف"), message: L("One of the IDs you listed doesn’t match an active student.", "أحد الأرقام الجامعية التي أضفتها لا يطابق طالبًا نشطًا.") });
        continue;
      }
      if (u.status === "suspended" || ix.activeRestriction(pid)) {
        fail({ code: "participant_invalid", check: "participants", personId: pid, title: L("Participant can’t join", "لا يمكن إضافة المشارك"), message: L(`${u.name}’s booking access is currently paused, so they can’t be added to a booking.`, `الحجز موقوف حاليًا لـ${u.name}، لذلك لا يمكن إضافته لأي حجز.`) });
      }
      const e = eligibility(facility, u);
      if (e) fail({ code: "participant_invalid", check: "participants", personId: pid, title: L("Participant not eligible", "المرفق غير متاح للمشارك"), message: L(`${u.name} isn’t eligible for ${fname}.`, `${fname} غير متاح لـ${u.name}.`) });
    }
  } else {
    skipped.add("participants");
  }

  /* 8 ─ Linked groups (different accounts, same group) */
  let linkedGroup: LinkedGroupHit | undefined;
  const lg = policy.fairness.linkedGroups;
  if (lg.enabled && facility.mode === "exclusive") {
    linkedGroup = findLinkedNeighbour(ix, facility, policy, start, end, [booker.id, ...participantIds], req.ignoreBookingId);
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
 * Two students are "linked" if they have been on at least N bookings together
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
      const theirs = [b.userId, ...b.participants.map((p) => p.userId)];
      if (theirs.some((id) => memberSet.has(id))) continue; // same person — handled by back-to-back rule
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
      if (bk.userId === b || bk.participants.some((p) => p.userId === b)) n++;
    }
    return n;
  };

  let best: LinkedGroupHit | undefined;
  for (const nb of neighbours) {
    const theirs = [...new Set([nb.userId, ...nb.participants.map((p) => p.userId)])];
    for (const m of members) {
      for (const o of theirs) {
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
