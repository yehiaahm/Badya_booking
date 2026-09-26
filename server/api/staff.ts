import { addDays, addMinutes, isSameDay, startOfDay } from "date-fns";
import { clock, fmtDayShort, fmtRange, fmtTime } from "@/lib/time";
import { L, N } from "@/i18n/lang";
import { facilityName, localFacility } from "@/domain/localize";
import { sessionTimes, capacityBookings } from "@/domain/engine";
import type { Booking, FacilityIssue, IssueCategory, MaintenancePeriod, User } from "@/domain/types";
import { ApiError, type ScanCandidate, type ScanResult, type StaffFacilityToday, type StaffOverview, type StaffSession, type StaffSessionBooking } from "@/api/types";
import { applyLadder, audit, bookingOrThrow, engine, facilityOrThrow, notify, policyFor, requirePermission, tick, toPublic, toView, updateBooking } from "./core";
import { db } from "./db";
import { dayStat } from "./metrics";
import { signToken, tamper, verifyToken, windowOf } from "./qr";

const label = (b: { start: string; end: string }) => `${fmtDayShort(b.start)}${L(", ", "، ")}${fmtRange(b.start, b.end)}`;

function assignedIds(u: User): string[] {
  if (u.role === "admin" || u.role === "super_admin") return db.state.facilities.map((f) => f.id);
  return u.assignedFacilityIds ?? [];
}

/** Facility staff can only work on the facilities they're assigned to; administrators on all. */
function assertAssigned(u: User, facilityId: string) {
  if (u.role === "admin" || u.role === "super_admin") return;
  if (!(u.assignedFacilityIds ?? []).includes(facilityId)) throw new ApiError("FORBIDDEN", "You’re not assigned to this facility.");
}

function staffBooking(b: Booking, viewerId: string): StaffSessionBooking {
  const v = toView(b, viewerId);
  const now = clock.now();
  const p = policyFor(v.facility);
  const start = new Date(b.start);
  const opens = addMinutes(start, -p.checkIn.opensMinutesBefore);
  const graceEnd = addMinutes(start, p.checkIn.graceMinutes);
  return {
    ...v,
    canCheckIn: b.status === "CONFIRMED" && now >= opens && now < new Date(b.end),
    canMarkNoShow: b.status === "CONFIRMED" && now >= graceEnd,
    late: b.status === "CONFIRMED" && now > start,
  };
}

export const staff = {
  async overview(): Promise<StaffOverview> {
    const u = requirePermission("schedule.view");
    await tick(true);
    const now = clock.now();
    const ids = assignedIds(u);
    const facilities: StaffFacilityToday[] = ids
      .map((id) => db.state.facilities.find((f) => f.id === id))
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map((f) => {
        const cat = db.state.categories.find((c) => c.id === f.categoryId)!;
        const ix = engine(now);
        const times = sessionTimes(f, now);
        let nextMarked = false;
        const sessions: StaffSession[] = times.map((t) => {
          const list = capacityBookings(ix, f.id, t.start.getTime(), t.end.getTime()).sort((a, b) => a.unitIndex - b.unitIndex || a.createdAt.localeCompare(b.createdAt));
          let state: StaffSession["state"] = "later";
          if (t.end <= now) state = "past";
          else if (t.start <= now) state = "now";
          else if (!nextMarked) {
            state = "next";
            nextMarked = true;
          }
          const maintenance = ix.maintenanceFor(f.id).find((m) => new Date(m.start) < t.end && new Date(m.end) > t.start);
          return { facilityId: f.id, start: t.start.toISOString(), end: t.end.toISOString(), unitCount: f.units, bookings: list.map((b) => staffBooking(b, u.id)), state, maintenance };
        });
        const cur = sessions.find((s) => s.state === "now");
        const st = dayStat(f, startOfDay(now));
        const today = db.state.bookings.filter((b) => b.facilityId === f.id && isSameDay(new Date(b.start), now));
        return {
          facility: f,
          category: cat,
          sessions,
          issues: db.state.issues.filter((i) => i.facilityId === f.id && i.status !== "resolved").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          maintenance: db.state.maintenance.filter((m) => m.facilityId === f.id && !m.cancelled && new Date(m.end) > now && new Date(m.start) < addDays(now, 7)),
          occupancyNow: cur ? { taken: cur.bookings.length, capacity: f.units, checkedIn: cur.bookings.filter((b) => b.status === "CHECKED_IN" || b.status === "COMPLETED").length } : null,
          stats: {
            booked: today.filter((b) => b.status !== "CANCELLED" && b.status !== "EXPIRED").length,
            checkedIn: today.filter((b) => b.status === "CHECKED_IN" || b.status === "COMPLETED").length,
            noShows: today.filter((b) => b.status === "NO_SHOW").length,
            utilization: st.capacity ? st.booked / st.capacity : 0,
          },
        };
      });
    const all = facilities.flatMap((f) => f.sessions.flatMap((s) => s.bookings));
    return {
      facilities,
      totals: {
        booked: all.length,
        checkedIn: all.filter((b) => b.status === "CHECKED_IN" || b.status === "COMPLETED").length,
        awaiting: all.filter((b) => b.status === "CONFIRMED" && new Date(b.end) > now).length,
        noShows: all.filter((b) => b.status === "NO_SHOW").length,
      },
    };
  },

  /** Validate a scanned QR at a facility and check the student in. */
  async scan(token: string, facilityId: string): Promise<ScanResult> {
    const u = requirePermission("checkin.perform");
    assertAssigned(u, facilityId);
    const verified = await verifyToken(token);
    return db.transaction(() => {
      const now = clock.now();
      const checks: ScanResult["checks"] = [];
      const fail = (title: string, message: string, extra: Partial<ScanResult> = {}): ScanResult => ({ ok: false, title, message, checks, ...extra });
      const add = (l: string, pass: boolean) => {
        checks.push({ label: l, status: pass ? "pass" : "fail" });
        return pass;
      };

      if (!add(L("QR code is authentic", "كود QR أصلي"), verified.valid && !!verified.payload)) return fail(L("Invalid QR code", "كود QR غير صالح"), L("This code wasn’t issued by Badya Spaces or has been altered. Ask the student to open their ticket in the app.", "هذا الكود لم يصدر من Badya Spaces أو تم التلاعب به. اطلب من الطالب فتح التذكرة من التطبيق."));
      const p = verified.payload!;
      const rot = db.state.settings.qrRotationSeconds;
      const w = windowOf(now.getTime(), rot);
      if (!add(L("QR code is current", "كود QR حديث"), p.w === w || p.w === w - 1)) return fail(L("QR code expired", "انتهت صلاحية كود QR"), L(`Tickets refresh every ${rot} seconds, so screenshots stop working. Ask the student to show the live code in the app.`, `التذاكر تتجدد كل ${rot} ثانية، لذلك لقطات الشاشة لا تعمل. اطلب من الطالب عرض الكود المباشر من التطبيق.`));
      const b = db.state.bookings.find((x) => x.id === p.b);
      if (!add(L("Booking exists", "الحجز موجود"), !!b)) return fail(L("Booking not found", "الحجز غير موجود"), L("We couldn’t find this booking. It may have been removed.", "لم نجد هذا الحجز. ربما تم حذفه."));
      const booking = b!;
      const view = toView(booking, u.id);
      const student = toPublic(db.state.users.find((x) => x.id === booking.userId));
      const base = { booking: view, student };
      if (!add(L("Belongs to this student", "يخص هذا الطالب"), p.u === booking.userId && p.f === booking.facilityId && p.s === booking.start)) return fail(L("Ticket doesn’t match", "التذكرة غير مطابقة"), L("The details in this QR code don’t match the booking record.", "بيانات كود QR لا تطابق سجل الحجز."), base);
      const here = db.state.facilities.find((f) => f.id === facilityId);
      if (!add(L(`Booked for ${here?.name ?? "this facility"}`, `محجوز في ${here ? facilityName(here) : "هذا المرفق"}`), booking.facilityId === facilityId)) {
        const lf = localFacility(view.facility);
        return fail(L("Wrong facility", "مرفق مختلف"), L(`This ticket is for ${lf.name} (${lf.location.building}${lf.location.floor ? `, ${lf.location.floor}` : ""}). Please direct the student there.`, `هذه التذكرة لـ${lf.name} (${lf.location.building}${lf.location.floor ? `، ${lf.location.floor}` : ""}). من فضلك وجّه الطالب إلى هناك.`), base);
      }
      if (!add(L("Booked for today", "محجوز لليوم"), isSameDay(new Date(booking.start), now))) return fail(L("Wrong day", "يوم مختلف"), L(`This booking is for ${label(booking)}. It can only be used on that day.`, `هذا الحجز لموعد ${label(booking)}. لا يمكن استخدامه إلا في ذلك اليوم.`), base);
      if (!add(L("Not cancelled", "غير ملغى"), booking.status !== "CANCELLED" && booking.status !== "EXPIRED"))
        return fail(L("Booking cancelled", "الحجز ملغى"), L(`This booking was cancelled${booking.cancellation ? ` on ${fmtDayShort(booking.cancellation.at)} at ${fmtTime(booking.cancellation.at)}` : ""} and can’t be used.`, `تم إلغاء هذا الحجز${booking.cancellation ? ` يوم ${fmtDayShort(booking.cancellation.at)} الساعة ${fmtTime(booking.cancellation.at)}` : ""} ولا يمكن استخدامه.`), base);
      if (booking.status === "CHECKED_IN" || booking.status === "COMPLETED") {
        add(L("Not already used", "لم يُستخدم من قبل"), false);
        return fail(L("Already checked in", "تم تسجيل الحضور بالفعل"), L(`This ticket was used at ${fmtTime(booking.checkIn!.at)}. Each ticket can be scanned once.`, `استُخدمت هذه التذكرة الساعة ${fmtTime(booking.checkIn!.at)}. كل تذكرة تُمسح مرة واحدة فقط.`), { ...base, alreadyCheckedIn: true });
      }
      add(L("Not already used", "لم يُستخدم من قبل"), true);
      if (booking.status === "PENDING") return fail(L("Not approved yet", "لم تتم الموافقة بعد"), L("This request hasn’t been approved, so it can’t be checked in.", "لم تتم الموافقة على هذا الطلب، لذلك لا يمكن تسجيل حضوره."), base);
      const pol = policyFor(view.facility);
      const opens = addMinutes(new Date(booking.start), -pol.checkIn.opensMinutesBefore);
      const closes = addMinutes(new Date(booking.start), pol.checkIn.graceMinutes);
      const inWindow = now >= opens && now <= closes && booking.status === "CONFIRMED";
      if (!add(L("Within the check-in window", "داخل وقت تسجيل الحضور"), inWindow)) {
        if (now < opens) return fail(L("Too early", "مبكر جدًا"), L(`Check-in opens at ${fmtTime(opens)} (${pol.checkIn.opensMinutesBefore} min before the ${fmtTime(booking.start)} session).`, `يبدأ تسجيل الحضور الساعة ${fmtTime(opens)} (قبل موعد ${fmtTime(booking.start)} بـ${N.minute(pol.checkIn.opensMinutesBefore)}).`), base);
        return fail(L("Check-in window closed", "انتهى وقت تسجيل الحضور"), booking.status === "NO_SHOW" ? L("This booking has already been marked as a no-show.", "تم تسجيل هذا الحجز كغياب بالفعل.") : L(`Check-in closed at ${fmtTime(closes)}. The student can talk to the facility supervisor.`, `انتهى تسجيل الحضور الساعة ${fmtTime(closes)}. يمكن للطالب التحدث مع مشرف المرفق.`), base);
      }
      const next = updateBooking(booking, { status: "CHECKED_IN", checkIn: { at: now.toISOString(), byUserId: u.id, method: "qr", headcount: booking.participants.length ? booking.participants.length + 1 : undefined } });
      audit(u, "booking.check_in", "booking", booking.id, booking.id, `Checked in ${student.name} at ${view.facility.name} (QR scan)`);
      notify(booking.userId, "checkin_success", () => L(`Checked in at ${view.facility.name}`, `تم تسجيل حضورك في ${facilityName(view.facility)}`), () => L(`Enjoy your session — it ends at ${fmtTime(booking.end)}.`, `استمتع بوقتك — الموعد ينتهي الساعة ${fmtTime(booking.end)}.`), { link: `/bookings/${booking.id}`, data: { bookingId: booking.id } });
      return { ok: true, title: L("Check-in successful", "تم تسجيل الحضور"), message: L(`${student.name} is checked in until ${fmtTime(booking.end)}.`, `تم تسجيل حضور ${student.name} حتى الساعة ${fmtTime(booking.end)}.`), checks, booking: toView(next, u.id), student };
    });
  },

  async checkIn(bookingId: string, headcount?: number) {
    const u = requirePermission("checkin.perform");
    return db.transaction(() => {
      const b = bookingOrThrow(bookingId);
      assertAssigned(u, b.facilityId);
      if (b.status !== "CONFIRMED") throw new ApiError("CONFLICT", b.status === "CHECKED_IN" ? "This booking is already checked in." : "Only confirmed bookings can be checked in.");
      const f = facilityOrThrow(b.facilityId);
      const now = clock.now();
      const p = policyFor(f);
      if (now < addMinutes(new Date(b.start), -p.checkIn.opensMinutesBefore)) throw new ApiError("CONFLICT", L(`Check-in opens ${p.checkIn.opensMinutesBefore} minutes before the session.`, `يبدأ تسجيل الحضور قبل الموعد بـ${N.minute(p.checkIn.opensMinutesBefore)}.`));
      if (now >= new Date(b.end)) throw new ApiError("CONFLICT", "This session has already ended.");
      const next = updateBooking(b, { status: "CHECKED_IN", checkIn: { at: now.toISOString(), byUserId: u.id, method: "manual", headcount } });
      const student = db.state.users.find((x) => x.id === b.userId);
      audit(u, "booking.check_in", "booking", b.id, b.id, `Checked in ${student?.name} at ${f.name} (manual)`);
      notify(b.userId, "checkin_success", () => L(`Checked in at ${f.name}`, `تم تسجيل حضورك في ${facilityName(f)}`), () => L(`Enjoy your session — it ends at ${fmtTime(b.end)}.`, `استمتع بوقتك — الموعد ينتهي الساعة ${fmtTime(b.end)}.`), { link: `/bookings/${b.id}` });
      return toView(next, u.id);
    });
  },

  async markNoShow(bookingId: string) {
    const u = requirePermission("noshow.mark");
    return db.transaction(() => {
      const b = bookingOrThrow(bookingId);
      assertAssigned(u, b.facilityId);
      const f = facilityOrThrow(b.facilityId);
      const p = policyFor(f);
      if (b.status !== "CONFIRMED") throw new ApiError("CONFLICT", "Only confirmed bookings that weren’t checked in can be marked as no-shows.");
      if (clock.now() < addMinutes(new Date(b.start), p.checkIn.graceMinutes)) throw new ApiError("CONFLICT", L(`Wait until the ${p.checkIn.graceMinutes}-minute grace period ends before marking a no-show.`, `انتظر حتى تنتهي فترة السماح (${N.minute(p.checkIn.graceMinutes)}) قبل تسجيل الغياب.`));
      const next = updateBooking(b, { status: "NO_SHOW", noShow: { at: clock.now().toISOString(), byUserId: u.id, auto: false } });
      const student = db.state.users.find((x) => x.id === b.userId);
      audit(u, "booking.no_show", "booking", b.id, b.id, `Marked ${student?.name} as no-show at ${f.name}`);
      applyLadder(b.userId, u);
      return toView(next, u.id);
    });
  },

  async undoNoShow(bookingId: string, reason: string) {
    const u = requirePermission("noshow.mark");
    return db.transaction(() => {
      const b = bookingOrThrow(bookingId);
      assertAssigned(u, b.facilityId);
      if (b.status !== "NO_SHOW" || !b.noShow) throw new ApiError("CONFLICT", "This booking isn’t marked as a no-show.");
      const next = updateBooking(b, { noShow: { ...b.noShow, waived: { at: clock.now().toISOString(), byUserId: u.id, reason } } });
      audit(u, "booking.waive_no_show", "booking", b.id, b.id, `Waived no-show strike — ${reason}`);
      notify(b.userId, "noshow_warning", () => L("Missed-session strike removed", "تم إلغاء مخالفة الغياب"), () => L(`The strike for ${label(b)} was removed: ${reason}.`, `تم إلغاء المخالفة الخاصة بموعد ${label(b)}: ${reason}.`), { link: "/profile" });
      return toView(next, u.id);
    });
  },

  async reportIssue(input: { facilityId: string; category: IssueCategory; severity: FacilityIssue["severity"]; description: string }) {
    const u = requirePermission("facility.report_issue");
    assertAssigned(u, input.facilityId);
    if (input.description.trim().length < 8) throw new ApiError("VALIDATION", "Please describe the problem in a few more words.");
    return db.transaction(() => {
      const f = facilityOrThrow(input.facilityId);
      const issue: FacilityIssue = { id: `IS-${420 + db.nextSeq()}`, ...input, description: input.description.trim(), reportedBy: u.id, createdAt: clock.now().toISOString(), status: "open" };
      db.put("issues", issue);
      audit(u, "issue.report", "issue", issue.id, f.name, `Reported: ${issue.description.slice(0, 60)} (${issue.severity})`);
      for (const a of db.state.users.filter((x) => (x.role === "admin" || x.role === "super_admin") && x.status === "active")) notify(a.id, "maintenance", () => L(`Issue reported: ${f.name}`, `بلاغ عن مشكلة: ${facilityName(f)}`), () => L(`${issue.description} — reported by ${u.name}.`, `${issue.description} — أبلغ عنها ${u.name}.`), { link: "/admin/facilities" });
      return issue;
    });
  },

  async updateIssue(id: string, status: FacilityIssue["status"]) {
    const u = requirePermission("facility.report_issue");
    return db.transaction(() => {
      const i = db.state.issues.find((x) => x.id === id);
      if (!i) throw new ApiError("NOT_FOUND", "Issue not found.");
      assertAssigned(u, i.facilityId);
      const next: FacilityIssue = { ...i, status, ...(status === "resolved" ? { resolvedAt: clock.now().toISOString(), resolvedBy: u.id } : {}) };
      db.put("issues", next);
      audit(u, "issue.update", "issue", i.id, facilityOrThrow(i.facilityId).name, `Issue marked ${status.replace("_", " ")}`);
      return next;
    });
  },

  /** Close a facility right now for a while. Affected bookings are cancelled without penalty. */
  async closeTemporarily(input: { facilityId: string; minutes: number; reason: string }) {
    const u = requirePermission("facility.close_temporarily");
    assertAssigned(u, input.facilityId);
    if (input.reason.trim().length < 4) throw new ApiError("VALIDATION", "Add a short reason — students will see it.");
    return db.transaction(() => {
      const f = facilityOrThrow(input.facilityId);
      const now = clock.now();
      const end = addMinutes(now, input.minutes);
      const m = closeWindow(u, f.id, now, end, input.reason.trim(), "staff_closure");
      audit(u, "facility.close_temporarily", "maintenance", m.id, f.name, `Closed until ${fmtTime(end)} — ${m.reason}. ${m.affectedBookingIds.length} bookings cancelled without penalty.`);
      return m;
    });
  },

  async reopen(maintenanceId: string) {
    const u = requirePermission("facility.close_temporarily");
    return db.transaction(() => {
      const m = db.state.maintenance.find((x) => x.id === maintenanceId);
      if (!m) throw new ApiError("NOT_FOUND", "Closure not found.");
      assertAssigned(u, m.facilityId);
      const now = clock.now();
      const next: MaintenancePeriod = new Date(m.start) > now ? { ...m, cancelled: true } : { ...m, end: now.toISOString() };
      db.put("maintenance", next);
      const f = facilityOrThrow(m.facilityId);
      audit(u, "facility.reopen", "maintenance", m.id, f.name, `Reopened ${f.name}`);
      return next;
    });
  },

  /** Sample tickets for the scanner simulation — real signed tokens. */
  async scanCandidates(facilityId: string): Promise<ScanCandidate[]> {
    assertAssigned(requirePermission("checkin.perform"), facilityId);
    if (!db.isDemo) return [];
    const now = clock.now();
    const w = windowOf(now.getTime(), db.state.settings.qrRotationSeconds);
    const users = new Map(db.state.users.map((x) => [x.id, x]));
    const sign = (b: Booking, win = w) => signToken({ b: b.id, u: b.userId, f: b.facilityId, s: b.start, w: win });
    const today = db.state.bookings.filter((b) => isSameDay(new Date(b.start), now));
    const out: ScanCandidate[] = [];
    const f = facilityOrThrow(facilityId);
    const p = policyFor(f);
    const valid = today
      .filter((b) => b.facilityId === facilityId && b.status === "CONFIRMED" && now >= addMinutes(new Date(b.start), -p.checkIn.opensMinutesBefore) && now <= addMinutes(new Date(b.start), p.checkIn.graceMinutes))
      .slice(0, 3);
    for (const b of valid) out.push({ kind: "valid", label: users.get(b.userId)?.name ?? "Student", hint: `${fmtRange(b.start, b.end)} · valid ticket`, token: await sign(b), facilityId });
    const used = today.find((b) => b.facilityId === facilityId && b.status === "CHECKED_IN");
    if (used) out.push({ kind: "used", label: users.get(used.userId)?.name ?? "Student", hint: "Already checked in", token: await sign(used), facilityId });
    const elsewhere = today.find((b) => b.facilityId !== facilityId && b.status === "CONFIRMED" && db.state.facilities.find((x) => x.id === b.facilityId)?.location.building !== f.location.building);
    if (elsewhere) out.push({ kind: "wrong_facility", label: users.get(elsewhere.userId)?.name ?? "Student", hint: `Booked at ${db.state.facilities.find((x) => x.id === elsewhere.facilityId)?.name}`, token: await sign(elsewhere), facilityId });
    const cancelled = db.state.bookings.find((b) => b.facilityId === facilityId && b.status === "CANCELLED" && isSameDay(new Date(b.start), now));
    if (cancelled) out.push({ kind: "cancelled", label: users.get(cancelled.userId)?.name ?? "Student", hint: "Cancelled booking", token: await sign(cancelled), facilityId });
    const tomorrow = db.state.bookings.find((b) => b.facilityId === facilityId && b.status === "CONFIRMED" && isSameDay(new Date(b.start), addDays(now, 1)));
    if (tomorrow) out.push({ kind: "wrong_day", label: users.get(tomorrow.userId)?.name ?? "Student", hint: "Booking is for tomorrow", token: await sign(tomorrow), facilityId });
    const any = valid[0] ?? today.find((b) => b.facilityId === facilityId);
    if (any) {
      out.push({ kind: "expired", label: "Screenshot of a ticket", hint: "QR from 5 minutes ago", token: await sign(any, w - 10), facilityId });
      out.push({ kind: "tampered", label: "Edited QR code", hint: "Booking ID changed by hand", token: tamper(await sign(any), { b: "BK-2026-999999" }), facilityId });
    }
    return out;
  },
};

/** Shared by staff closures and admin maintenance. */
export function closeWindow(actor: User, facilityId: string, start: Date, end: Date, reason: string, kind: MaintenancePeriod["kind"]): MaintenancePeriod {
  const f = facilityOrThrow(facilityId);
  const affected = db.state.bookings.filter((b) => b.facilityId === facilityId && (b.status === "CONFIRMED" || b.status === "PENDING") && new Date(b.start) < end && new Date(b.end) > start);
  const m: MaintenancePeriod = { id: `MT-${200 + db.nextSeq()}`, facilityId, start: start.toISOString(), end: end.toISOString(), reason, kind, createdBy: actor.id, createdAt: clock.now().toISOString(), affectedBookingIds: affected.map((b) => b.id) };
  db.put("maintenance", m);
  for (const b of affected) {
    updateBooking(b, { status: "CANCELLED", cancellation: { at: clock.now().toISOString(), byUserId: actor.id, reason: `Facility ${kind === "planned" ? "maintenance" : "closed"}: ${reason}`, late: false, penalty: false, byRole: actor.role } });
    for (const id of [b.userId, ...b.participants.map((p) => p.userId)]) {
      notify(
        id,
        "maintenance",
        () => L(`${f.name} is closed — booking cancelled`, `${facilityName(f)} مغلق — تم إلغاء الحجز`),
        () => L(`Your session on ${label(b)} was cancelled because ${f.name} is closed (${reason.toLowerCase()}). No strike has been recorded. We’re sorry for the disruption.`, `تم إلغاء موعدك ${label(b)} لأن ${facilityName(f)} مغلق (${reason}). لم تُسجّل عليك مخالفة. نعتذر عن الإزعاج.`),
        { link: `/facility/${f.id}` },
      );
    }
  }
  // Anyone waiting for these sessions will not get a spot.
  for (const w of db.state.waitlist) {
    if (w.facilityId === facilityId && (w.status === "waiting" || w.status === "offered") && new Date(w.start) < end && new Date(w.end) > start) db.put("waitlist", { ...w, status: "cancelled" });
  }
  return m;
}

