import { addDays, format, startOfDay } from "date-fns";
import { clock, fmtDayShort, fmtRange } from "@/lib/time";
import { computeStanding, evaluateBooking, findSession, UPCOMING_STATUSES, type Evaluation } from "@/domain/engine";
import { countOverrides } from "@/domain/policy";
import { facilityName } from "@/domain/localize";
import { L, N, withLanguage } from "@/i18n/lang";
import type { Booking, BookingPolicy, Facility, FacilityCategory, PolicyOverride, Permission, Restriction, RoleKey, SystemSettings, User } from "@/domain/types";
import {
  ApiError,
  type AdminDashboard,
  type AnalyticsData,
  type AuditQuery,
  type BookingQuery,
  type BookingView,
  type DeviceRequestView,
  type FlagView,
  type ImpactPreview,
  type MaintenanceView,
  type Page,
  type StudentDetail,
  type StudentRow,
  type TeamMember,
  type WaitlistSessionView,
} from "@/api/types";
import { audit, bookingOrThrow, currentUser, engine, facilityOrThrow, notify, offerNext, requirePermission, tick, toPublic, toView, updateBooking } from "./core";
import { db } from "./db";
import { dayStat, utilization } from "./metrics";
import { closeWindow } from "./staff";
import { standingInfo, summarize } from "./student";
import { decideDeviceRequest, domainAllowed, resetDevices, setTemporaryPassword } from "./auth";

const label = (b: { start: string; end: string }) => `${fmtDayShort(b.start)}${L(", ", "، ")}${fmtRange(b.start, b.end)}`;
const ISSUE_AR: Record<string, string> = { equipment: "معدات", cleanliness: "نظافة", safety: "سلامة", lighting: "إضاءة", surface: "أرضية", access: "دخول", other: "آخر" };

/** The audit log stays in English. */
const enLabel = (b: { start: string; end: string }) => withLanguage("en", () => label(b));
const pct = (n: number) => Math.round(n * 1000) / 10;

function paginate<T>(rows: T[], page = 1, pageSize = 25): Page<T> {
  const p = Math.max(1, page);
  return { rows: rows.slice((p - 1) * pageSize, p * pageSize), total: rows.length, page: p, pageSize };
}

function studentRow(u: User): StudentRow {
  const ix = engine();
  const st = computeStanding(ix, u.id);
  const mine = ix.involvements(u.id).filter((b) => b.userId === u.id);
  return {
    user: u,
    level: st.level,
    strikes: st.strikes.length,
    activeBookings: mine.filter((b) => UPCOMING_STATUSES.has(b.status) && new Date(b.end) > ix.now).length,
    totalBookings: mine.filter((b) => b.status !== "CANCELLED").length,
    noShows: mine.filter((b) => b.status === "NO_SHOW").length,
    restriction: st.restriction,
  };
}

function heatmapFor(facs: Facility[], from: Date, days: number) {
  const cells = new Map<string, { booked: number; cap: number }>();
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i);
    for (const f of facs) {
      const st = dayStat(f, day);
      const caps = new Array(24).fill(0);
      const sess = st.capacity > 0 ? st.capacity / f.units : 0;
      if (sess > 0) {
        const hrs = f.schedule[day.getDay()];
        if (hrs) {
          const open = Number(hrs.open.slice(0, 2));
          const close = Number(hrs.close.slice(0, 2));
          for (let h = open; h < Math.max(close, open + 1); h++) caps[h] += f.units * (60 / (f.sessionMinutes + f.turnoverMinutes));
        }
      }
      for (let h = 0; h < 24; h++) {
        const k = `${day.getDay()}|${h}`;
        const c = cells.get(k) ?? { booked: 0, cap: 0 };
        c.booked += st.byHour[h];
        c.cap += caps[h];
        cells.set(k, c);
      }
    }
  }
  const out: { weekday: number; hour: number; value: number }[] = [];
  for (let wd = 0; wd < 7; wd++) for (let h = 6; h < 24; h++) {
    const c = cells.get(`${wd}|${h}`);
    out.push({ weekday: wd, hour: h, value: c && c.cap > 0 ? Math.min(1, c.booked / c.cap) : 0 });
  }
  return out;
}

export const admin = {
  /* ───────────── Dashboard ───────────── */
  async dashboard(): Promise<AdminDashboard> {
    requirePermission("analytics.view");
    await tick(true);
    const now = clock.now();
    const today = startOfDay(now);
    const s = db.state;
    const facs = s.facilities;
    const todays = s.bookings.filter((b) => startOfDay(new Date(b.start)).getTime() === today.getTime());
    const live = todays.filter((b) => b.status !== "CANCELLED" && b.status !== "EXPIRED");
    const range = (from: Date, days: number) => {
      let booked = 0, cap = 0, ns = 0;
      for (let i = 0; i < days; i++) for (const f of facs) {
        const st = dayStat(f, addDays(from, i));
        booked += st.booked;
        cap += st.capacity;
        ns += st.noShows;
      }
      return { util: cap ? booked / cap : 0, noShowRate: booked ? ns / booked : 0 };
    };
    const last7 = range(addDays(today, -7), 7);
    const prev7 = range(addDays(today, -14), 7);
    const todayCap = facs.reduce((a, f) => a + dayStat(f, today).capacity, 0);

    const trend = Array.from({ length: 14 }, (_, i) => {
      const day = addDays(today, i - 13);
      let booked = 0, noShows = 0, cancelled = 0;
      for (const f of facs) {
        const st = dayStat(f, day);
        booked += st.booked;
        noShows += st.noShows;
        cancelled += st.cancellations;
      }
      return { day: format(day, "yyyy-MM-dd"), booked, noShows, cancelled };
    });

    const attention: AdminDashboard["attention"] = [];
    const pending = s.bookings.filter((b) => b.status === "PENDING");
    const fname = (id: string) => {
      const f = facs.find((x) => x.id === id);
      return f ? facilityName(f) : "";
    };
    if (pending.length) attention.push({ id: "pending", tone: "warning", title: L(`${pending.length} ${pending.length === 1 ? "request needs" : "requests need"} approval`, `${N.request(pending.length)} بانتظار الموافقة`), detail: [...new Set(pending.map((b) => fname(b.facilityId)))].join(L(", ", "، ")), link: "/admin/bookings?status=PENDING" });
    const devicePending = s.deviceRequests.filter((r) => r.status === "pending");
    if (devicePending.length) attention.push({ id: "devices", tone: "warning", title: L(`${devicePending.length} device ${devicePending.length === 1 ? "request needs" : "requests need"} approval`, `${N.request(devicePending.length)} أجهزة بانتظار الموافقة`), detail: L("Students trying to sign in on a new or shared device.", "طلاب يحاولون تسجيل الدخول من جهاز جديد أو مشترك."), link: "/admin/devices" });
    const flags = s.flags.filter((f) => f.status === "open");
    if (flags.length) attention.push({ id: "flags", tone: "danger", title: L(`${flags.length} fair-use ${flags.length === 1 ? "flag" : "flags"} to review`, `تنبيهات استخدام عادل للمراجعة: ${flags.length}`), detail: flags.map((f) => f.summary.split(".")[0]).slice(0, 1).join(""), link: "/admin/fairness" });
    for (const i of s.issues.filter((x) => x.status !== "resolved").sort((a, b) => (a.severity === "high" ? -1 : 1) - (b.severity === "high" ? -1 : 1)).slice(0, 3)) {
      attention.push({ id: i.id, tone: i.severity === "high" ? "danger" : "warning", title: L(`${fname(i.facilityId)}: ${i.category} issue`, `${fname(i.facilityId)}: بلاغ ${ISSUE_AR[i.category] ?? i.category}`), detail: i.description, link: "/admin/facilities" });
    }
    for (const m of s.maintenance.filter((m) => !m.cancelled && new Date(m.end) > now && new Date(m.start) < addDays(now, 3))) {
      attention.push({ id: m.id, tone: "info", title: (() => {
        const mf = facs.find((f) => f.id === m.facilityId);
        const n = mf ? facilityName(mf) : "";
        return new Date(m.start) <= now ? L(`${n} closed now`, `${n} مغلق الآن`) : L(`${n} closing soon`, `${n} سيُغلق قريبًا`);
      })(), detail: `${label(m)} — ${m.reason}`, link: "/admin/maintenance" });
    }
    const wlWaiting = s.waitlist.filter((w) => w.status === "waiting" && new Date(w.start) > now).length;
    const wlOffered = s.waitlist.filter((w) => w.status === "offered" && new Date(w.start) > now).length;

    return {
      kpis: {
        facilities: { active: facs.filter((f) => f.status === "active").length, total: facs.length, maintenance: s.maintenance.filter((m) => !m.cancelled && new Date(m.start) <= now && new Date(m.end) > now).length },
        today: { bookings: live.length, checkedIn: live.filter((b) => b.status === "CHECKED_IN" || b.status === "COMPLETED").length, upcoming: live.filter((b) => b.status === "CONFIRMED" && new Date(b.start) > now).length, cancelled: todays.filter((b) => b.status === "CANCELLED").length },
        activeNow: s.bookings.filter((b) => b.status === "CHECKED_IN").length,
        noShows: { today: todays.filter((b) => b.status === "NO_SHOW").length, rate7d: last7.noShowRate, ratePrev7d: prev7.noShowRate },
        utilization: { today: todayCap ? live.length / todayCap : 0, last7d: last7.util, prev7d: prev7.util },
        waitlist: { waiting: wlWaiting, offered: wlOffered },
      },
      bookingsTrend: trend,
      utilizationByFacility: facs
        .filter((f) => f.status === "active")
        .map((f) => ({ facilityId: f.id, name: facilityName(f), color: s.categories.find((c) => c.id === f.categoryId)?.color ?? "#888", value: utilization(f, addDays(today, -7), 7) }))
        .sort((a, b) => b.value - a.value),
      heatmap: heatmapFor(facs.filter((f) => f.status === "active"), addDays(today, -28), 28),
      attention,
      activity: [...s.audit].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12),
    };
  },

  /* ───────────── Facilities & categories ───────────── */
  async facilities() {
    const u = requirePermission("facility.view");
    const now = clock.now();
    return db.state.facilities.map((f) => ({
      ...summarize(f, u),
      overrides: countOverrides(f.policy),
      openIssues: db.state.issues.filter((i) => i.facilityId === f.id && i.status !== "resolved").length,
      upcomingBookings: db.state.bookings.filter((b) => b.facilityId === f.id && UPCOMING_STATUSES.has(b.status) && new Date(b.start) > now).length,
    }));
  },

  async facility(id: string) {
    requirePermission("facility.manage");
    const f = facilityOrThrow(id);
    return { facility: f, issues: db.state.issues.filter((i) => i.facilityId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  },

  async saveFacility(input: Facility, isNew: boolean) {
    const u = requirePermission("facility.manage");
    const errors: string[] = [];
    if (input.name.trim().length < 3) errors.push("Give the facility a name of at least 3 characters.");
    if (input.units < 1) errors.push("Capacity must be at least 1.");
    if (input.sessionMinutes < 15) errors.push("Sessions must be at least 15 minutes.");
    if (!input.schedule.some(Boolean)) errors.push("Open the facility on at least one day.");
    for (const h of input.schedule) if (h && h.close <= h.open) errors.push("Closing time must be after opening time.");
    if (!input.location.building.trim()) errors.push("Add the building so students can find it.");
    if (errors.length) throw new ApiError("VALIDATION", errors[0], undefined, { errors });
    return db.transaction(() => {
      const now = clock.now().toISOString();
      if (isNew && db.state.facilities.some((f) => f.id === input.id)) throw new ApiError("CONFLICT", "A facility with this ID already exists.");
      const prev = db.state.facilities.find((f) => f.id === input.id);
      const f: Facility = { ...input, name: input.name.trim(), capacity: input.mode === "shared" ? 1 : input.capacity, createdAt: prev?.createdAt ?? now, updatedAt: now };
      db.put("facilities", f);
      audit(u, isNew ? "facility.create" : "facility.update", "facility", f.id, f.name, isNew ? `Created ${f.name} (${f.mode === "shared" ? `${f.units} ${f.unitLabel}s` : `${f.units} × ${f.unitLabel}`}, ${f.sessionMinutes}-min sessions)` : `Updated ${f.name}`);
      return f;
    });
  },

  async setFacilityStatus(id: string, status: Facility["status"], reason?: string) {
    const u = requirePermission("facility.manage");
    return db.transaction(() => {
      const f = facilityOrThrow(id);
      const next: Facility = { ...f, status, inactiveReason: status === "inactive" ? reason || "Temporarily unavailable" : undefined, updatedAt: clock.now().toISOString() };
      db.put("facilities", next);
      let cancelled = 0;
      if (status === "inactive") {
        const affected = db.state.bookings.filter((b) => b.facilityId === id && UPCOMING_STATUSES.has(b.status) && new Date(b.start) > clock.now());
        for (const b of affected) {
          updateBooking(b, { status: "CANCELLED", cancellation: { at: clock.now().toISOString(), byUserId: u.id, reason: `Facility closed: ${next.inactiveReason}`, late: false, penalty: false, byRole: u.role } });
          notify(
            b.userId,
            "maintenance",
            () => L(`${f.name} is closed — booking cancelled`, `${facilityName(f)} مغلق — تم إلغاء الحجز`),
            () => L(`Your session on ${label(b)} was cancelled: ${next.inactiveReason}. No strike has been recorded.`, `تم إلغاء موعدك ${label(b)}: ${next.inactiveReason}. لم تُسجّل عليك مخالفة.`),
          );
          cancelled++;
        }
      } else {
        const fav = db.state.favorites.filter((x) => x.facilityId === id);
        for (const x of fav) notify(x.userId, "facility_reopened", () => L(`${f.name} is open again`, `${facilityName(f)} مفتوح مرة أخرى`), () => L("Sessions are available to book now.", "المواعيد متاحة للحجز الآن."), { link: `/facility/${id}` });
      }
      audit(u, status === "inactive" ? "facility.deactivate" : "facility.activate", "facility", id, f.name, status === "inactive" ? `Deactivated — ${next.inactiveReason}. ${cancelled} upcoming bookings cancelled without penalty.` : "Reactivated and reopened for booking");
      return { facility: next, cancelled };
    });
  },

  async saveCategory(input: FacilityCategory, isNew: boolean) {
    const u = requirePermission("category.manage");
    if (input.name.trim().length < 3) throw new ApiError("VALIDATION", "Give the category a name of at least 3 characters.");
    return db.transaction(() => {
      db.put("categories", { ...input, name: input.name.trim() });
      audit(u, isNew ? "category.create" : "category.update", "category", input.id, input.name, isNew ? `Created facility type “${input.name}”` : `Updated facility type “${input.name}”`);
      return input;
    });
  },

  /* ───────────── Policies ───────────── */
  async policies() {
    requirePermission("policy.manage");
    return { global: db.state.globalPolicy, categories: [...db.state.categories].sort((a, b) => a.sortOrder - b.sortOrder), facilities: db.state.facilities };
  },

  async updateGlobalPolicy(p: BookingPolicy, summary: string) {
    const u = requirePermission("policy.global.manage");
    if (p.noShow.ladder.length === 0) throw new ApiError("VALIDATION", "The no-show ladder needs at least one step.");
    return db.transaction(() => {
      db.setSingleton("globalPolicy", p);
      audit(u, "policy.update", "policy", "global", "Global policy", summary || "Updated global booking policy");
      return p;
    });
  },

  async updateCategoryPolicy(categoryId: string, override: PolicyOverride, summary: string) {
    const u = requirePermission("policy.manage");
    return db.transaction(() => {
      const c = db.state.categories.find((x) => x.id === categoryId);
      if (!c) throw new ApiError("NOT_FOUND", "Category not found.");
      db.put("categories", { ...c, policy: override });
      audit(u, "policy.update", "policy", c.id, c.name, summary || `Updated ${c.name} rules`);
      return override;
    });
  },

  async updateFacilityPolicy(facilityId: string, override: PolicyOverride, summary: string) {
    const u = requirePermission("policy.manage");
    return db.transaction(() => {
      const f = facilityOrThrow(facilityId);
      db.put("facilities", { ...f, policy: override, updatedAt: clock.now().toISOString() });
      audit(u, "policy.update", "policy", f.id, f.name, summary || `Updated ${f.name} rules`);
      return override;
    });
  },

  /** Run the real rule pipeline for any student and session — without booking. */
  async simulate(input: { userId: string; facilityId: string; start: string; participantIds: string[] }): Promise<Evaluation> {
    requirePermission("policy.manage");
    return evaluateBooking(engine(), input);
  },


  /* ───────────── Bookings ───────────── */
  async bookings(q: BookingQuery): Promise<Page<BookingView>> {
    const u = requirePermission("booking.manage");
    await tick();
    const users = new Map(db.state.users.map((x) => [x.id, x]));
    const term = q.q?.trim().toLowerCase();
    let rows = db.state.bookings.filter((b) => {
      if (q.facilityId && b.facilityId !== q.facilityId) return false;
      if (q.userId && b.userId !== q.userId && !b.participants.some((p) => p.userId === q.userId)) return false;
      if (q.statuses?.length && !q.statuses.includes(b.status)) return false;
      if (q.from && b.start < q.from) return false;
      if (q.to && b.start >= q.to) return false;
      if (term) {
        const booker = users.get(b.userId);
        if (!b.id.toLowerCase().includes(term) && !booker?.name.toLowerCase().includes(term) && !booker?.universityId?.includes(term)) return false;
      }
      return true;
    });
    const sort = q.sort ?? "start_asc";
    rows = rows.sort((a, b) => (sort === "start_asc" ? a.start.localeCompare(b.start) : sort === "start_desc" ? b.start.localeCompare(a.start) : b.createdAt.localeCompare(a.createdAt)));
    const page = paginate(rows, q.page, q.pageSize ?? 20);
    return { ...page, rows: page.rows.map((b) => toView(b, u.id)) };
  },

  async cancelBooking(id: string, reason: string, notifyStudent = true) {
    const u = requirePermission("booking.manage");
    return db.transaction(() => {
      const b = bookingOrThrow(id);
      if (!UPCOMING_STATUSES.has(b.status)) throw new ApiError("CONFLICT", "Only pending or confirmed bookings can be cancelled.");
      const f = facilityOrThrow(b.facilityId);
      const next = updateBooking(b, { status: "CANCELLED", cancellation: { at: clock.now().toISOString(), byUserId: u.id, reason: reason || "Cancelled by the facilities office", late: false, penalty: false, byRole: u.role } });
      if (notifyStudent) for (const id2 of [b.userId, ...b.participants.map((p) => p.userId)]) notify(id2, "booking_cancelled", () => L(`${f.name} booking cancelled`, `تم إلغاء حجز ${facilityName(f)}`), () => L(`The facilities office cancelled ${label(b)}: ${reason || "no reason given"}. No strike has been recorded.`, `ألغى مكتب إدارة المرافق موعد ${label(b)}${reason ? `: ${reason}` : ""}. لم تُسجّل عليك مخالفة.`), { data: { bookingId: b.id } });
      audit(u, "booking.cancel", "booking", b.id, b.id, `Cancelled ${f.name}, ${enLabel(b)} on behalf of the student — ${reason || "no reason"}`);
      if (b.status === "CONFIRMED") offerNext(f.id, b.start);
      return toView(next, u.id);
    });
  },

  async decide(id: string, decision: "approved" | "rejected", note?: string) {
    const u = requirePermission("booking.manage");
    return db.transaction(() => {
      const b = bookingOrThrow(id);
      if (b.status !== "PENDING") throw new ApiError("CONFLICT", "This request has already been handled.");
      const f = facilityOrThrow(b.facilityId);
      const next = updateBooking(b, { status: decision === "approved" ? "CONFIRMED" : "CANCELLED", approval: { at: clock.now().toISOString(), byUserId: u.id, decision, note }, ...(decision === "rejected" ? { cancellation: { at: clock.now().toISOString(), byUserId: u.id, reason: note || "Request declined", late: false, penalty: false, byRole: u.role } } : {}) });
      notify(
        b.userId,
        decision === "approved" ? "booking_approved" : "booking_rejected",
        () => (decision === "approved" ? L(`${f.name} approved`, `تمت الموافقة على ${facilityName(f)}`) : L(`${f.name} request declined`, `تم رفض طلب ${facilityName(f)}`)),
        () => (decision === "approved" ? L(`${label(b)} is confirmed. Your QR ticket is ready.`, `تم تأكيد موعد ${label(b)}. تذكرة QR جاهزة.`) : L(`${label(b)} — ${note || "the facility isn’t available for this request"}.`, `${label(b)} — ${note || "المرفق غير متاح لهذا الطلب"}.`)),
        { link: `/bookings/${b.id}`, data: { bookingId: b.id } },
      );
      audit(u, decision === "approved" ? "booking.approve" : "booking.reject", "booking", b.id, b.id, `${decision === "approved" ? "Approved" : "Declined"} ${f.name} request for ${enLabel(b)}${note ? ` — ${note}` : ""}`);
      return toView(next, u.id);
    });
  },

  /* ───────────── Students ───────────── */
  async students(q: { q?: string; level?: string; faculty?: string; page?: number }): Promise<Page<StudentRow>> {
    requirePermission("student.manage");
    const term = q.q?.trim().toLowerCase();
    let rows = db.state.users.filter((u) => u.role === "student").filter((u) => !term || u.name.toLowerCase().includes(term) || u.universityId?.includes(term) || u.email.includes(term));
    if (q.faculty) rows = rows.filter((u) => u.faculty === q.faculty);
    let mapped = rows.map(studentRow);
    if (q.level) mapped = mapped.filter((r) => (q.level === "attention" ? r.level !== "good" : r.level === q.level));
    mapped.sort((a, b) => {
      const rank = { restricted: 0, final_warning: 1, warning: 2, good: 3 } as const;
      return rank[a.level] - rank[b.level] || b.activeBookings - a.activeBookings || a.user.name.localeCompare(b.user.name);
    });
    return paginate(mapped, q.page, 20);
  },

  async student(id: string): Promise<StudentDetail> {
    const me = requirePermission("student.manage");
    const u = db.state.users.find((x) => x.id === id && x.role === "student");
    if (!u) throw new ApiError("NOT_FOUND", "Student not found.");
    const ix = engine();
    const involvements = ix.involvements(id);
    const counts = new Map<string, number>();
    for (const b of involvements) {
      if (b.status === "CANCELLED") continue;
      for (const x of [b.userId, ...b.participants.map((p) => p.userId)]) if (x !== id) counts.set(x, (counts.get(x) ?? 0) + 1);
    }
    const users = new Map(db.state.users.map((x) => [x.id, x]));
    return {
      ...studentRow(u),
      standing: standingInfo(id),
      bookings: [...involvements].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 40).map((b) => toView(b, me.id)),
      restrictions: db.state.restrictions.filter((r) => r.userId === id).sort((a, b) => b.start.localeCompare(a.start)),
      flags: db.state.flags.filter((f) => f.userIds.includes(id)),
      frequentPartners: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([uid, shared]) => ({ user: toPublic(users.get(uid)), shared })),
      devices: db.state.devices.filter((d) => d.userId === id).map((d) => ({ label: d.label, boundAt: d.boundAt, lastSeenAt: d.lastSeenAt })),
      pendingDeviceRequests: db.state.deviceRequests.filter((r) => r.userId === id && r.status === "pending").length,
    };
  },

  async restrict(userId: string, days: number, reason: string) {
    const me = requirePermission("student.manage");
    if (reason.trim().length < 4) throw new ApiError("VALIDATION", "Add a reason — the student will see it.");
    return db.transaction(() => {
      const u = db.state.users.find((x) => x.id === userId)!;
      const now = clock.now();
      const r: Restriction = { id: `RS-${4000 + db.nextSeq()}`, userId, reason: reason.trim(), source: "admin", start: now.toISOString(), end: addDays(now, days).toISOString(), createdBy: me.id };
      db.put("restrictions", r);
      notify(userId, "restriction", () => L(`Booking paused for ${days} days`, `تم إيقاف الحجز لمدة ${N.day(days)}`), () => L(`${reason.trim()}. New bookings are paused until ${fmtDayShort(r.end)}. Contact the facilities office if you have questions.`, `${reason.trim()}. الحجز الجديد متوقف حتى ${fmtDayShort(r.end)}. تواصل مع مكتب إدارة المرافق لو عندك أي استفسار.`), { link: "/profile" });
      audit(me, "restriction.create", "restriction", r.id, u.name, `Paused booking for ${days} days — ${reason.trim()}`);
      return r;
    });
  },

  async liftRestriction(id: string, reason: string) {
    const me = requirePermission("student.manage");
    return db.transaction(() => {
      const r = db.state.restrictions.find((x) => x.id === id);
      if (!r) throw new ApiError("NOT_FOUND", "Restriction not found.");
      const next = { ...r, lifted: { at: clock.now().toISOString(), byUserId: me.id, reason: reason || "Lifted by administrator" } };
      db.put("restrictions", next);
      const u = db.state.users.find((x) => x.id === r.userId)!;
      notify(r.userId, "restriction", () => L("You can book again", "يمكنك الحجز مرة أخرى"), () => L("Your booking restriction has been lifted. Welcome back!", "تم رفع إيقاف الحجز عنك. أهلًا بعودتك!"), { link: "/explore" });
      audit(me, "restriction.lift", "restriction", r.id, u.name, `Lifted restriction — ${next.lifted.reason}`);
      return next;
    });
  },

  async waiveStrike(bookingId: string, reason: string) {
    const me = requirePermission("student.manage");
    return db.transaction(() => {
      const b = bookingOrThrow(bookingId);
      if (b.status === "NO_SHOW" && b.noShow) updateBooking(b, { noShow: { ...b.noShow, waived: { at: clock.now().toISOString(), byUserId: me.id, reason } } });
      else if (b.cancellation?.penalty) updateBooking(b, { cancellation: { ...b.cancellation, penalty: false } });
      else throw new ApiError("CONFLICT", "There’s no strike on this booking.");
      audit(me, "booking.waive_no_show", "booking", b.id, b.id, `Waived strike — ${reason}`);
      notify(b.userId, "noshow_warning", () => L("A strike was removed", "تم إلغاء مخالفة"), () => L(`The strike for ${label(b)} was removed: ${reason}.`, `تم إلغاء المخالفة الخاصة بموعد ${label(b)}: ${reason}.`), { link: "/profile" });
    });
  },

  /* ───────────── Devices ───────────── */
  async deviceRequests(): Promise<DeviceRequestView[]> {
    requirePermission("student.manage");
    const users = new Map(db.state.users.map((x) => [x.id, x]));
    const since = addDays(clock.now(), -30).toISOString();
    return db.state.deviceRequests
      .filter((r) => r.status === "pending" || (r.decidedAt ?? r.createdAt) >= since)
      .sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.createdAt.localeCompare(a.createdAt))
      .map((r) => {
        const u = users.get(r.userId);
        return {
          ...r,
          user: { ...toPublic(u), email: u?.email ?? "" },
          otherUser: r.otherUserId ? toPublic(users.get(r.otherUserId)) : undefined,
          linkedDevices: db.state.devices.filter((d) => d.userId === r.userId).map((d) => ({ label: d.label, boundAt: d.boundAt, lastSeenAt: d.lastSeenAt })),
          decidedByName: r.decidedBy ? users.get(r.decidedBy)?.name : undefined,
        };
      });
  },

  async decideDeviceRequest(id: string, decision: "approved" | "rejected", note?: string) {
    const me = requirePermission("student.manage");
    await db.transaction(() => decideDeviceRequest(me, id, decision, note?.trim()));
  },

  async resetStudentDevices(userId: string, reason: string) {
    const me = requirePermission("student.manage");
    if (reason.trim().length < 4) throw new ApiError("VALIDATION", "Add a short reason — the student will see it.");
    await db.transaction(() => resetDevices(me, userId, reason.trim()));
  },

  /* ───────────── Fairness ───────────── */
  async flags(): Promise<FlagView[]> {
    const me = requirePermission("fairness.review");
    const users = new Map(db.state.users.map((x) => [x.id, x]));
    return [...db.state.flags]
      .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.createdAt.localeCompare(a.createdAt))
      .map((f) => ({ ...f, users: f.userIds.map((id) => toPublic(users.get(id))), bookings: f.bookingIds.map((id) => db.state.bookings.find((b) => b.id === id)).filter((b): b is Booking => !!b).map((b) => toView(b, me.id)), facility: facilityOrThrow(f.facilityId) }));
  },

  async resolveFlag(id: string, action: "dismissed" | "warned" | "restricted", note: string) {
    const me = requirePermission("fairness.review");
    return db.transaction(() => {
      const f = db.state.flags.find((x) => x.id === id);
      if (!f) throw new ApiError("NOT_FOUND", "Flag not found.");
      const fac = facilityOrThrow(f.facilityId);
      db.put("flags", { ...f, status: action === "dismissed" ? "dismissed" : "actioned", resolution: { at: clock.now().toISOString(), byUserId: me.id, action, note } });
      if (action === "warned") for (const uid of f.userIds) notify(uid, "fairness_notice", () => L("A note about fair use", "ملاحظة عن الاستخدام العادل"), () => L(`Recent back-to-back ${fac.name} bookings by your group were reviewed. Please give other students a turn — repeated patterns can lead to booking restrictions.`, `تمت مراجعة حجوزات ${facilityName(fac)} المتتالية الأخيرة لمجموعتك. من فضلك أعطِ فرصة لباقي الطلاب — تكرار هذا النمط قد يؤدي لإيقاف الحجز.`), { link: "/profile" });
      if (action === "restricted") {
        for (const uid of f.userIds) {
          const r: Restriction = { id: `RS-${4000 + db.nextSeq()}`, userId: uid, reason: "Fair-use violation — linked back-to-back bookings", source: "admin", start: clock.now().toISOString(), end: addDays(clock.now(), 7).toISOString(), createdBy: me.id };
          db.put("restrictions", r);
          notify(uid, "restriction", () => L("Booking paused for 7 days", "تم إيقاف الحجز لمدة 7 أيام"), () => L(`After a fair-use review of ${fac.name} bookings, new bookings are paused until ${fmtDayShort(r.end)}.`, `بعد مراجعة الاستخدام العادل لحجوزات ${facilityName(fac)}، الحجز الجديد متوقف حتى ${fmtDayShort(r.end)}.`), { link: "/profile" });
        }
      }
      audit(me, "flag.resolve", "flag", f.id, fac.name, `${action === "dismissed" ? "Dismissed" : action === "warned" ? "Warned students on" : "Restricted students on"} flag ${f.id}${note ? ` — ${note}` : ""}`);
    });
  },

  /* ───────────── Maintenance ───────────── */
  async maintenance(): Promise<MaintenanceView[]> {
    requirePermission("maintenance.manage");
    const now = clock.now();
    const users = new Map(db.state.users.map((x) => [x.id, x]));
    return [...db.state.maintenance]
      .sort((a, b) => b.start.localeCompare(a.start))
      .map((m) => ({ ...m, facility: facilityOrThrow(m.facilityId), createdByName: users.get(m.createdBy)?.name ?? "System", state: m.cancelled ? "cancelled" : new Date(m.end) <= now ? "completed" : new Date(m.start) <= now ? "active" : "scheduled" }));
  },

  async maintenanceImpact(facilityId: string, start: string, end: string): Promise<ImpactPreview> {
    const me = requirePermission("maintenance.manage");
    const s = new Date(start);
    const e = new Date(end);
    const bookings = db.state.bookings.filter((b) => b.facilityId === facilityId && UPCOMING_STATUSES.has(b.status) && new Date(b.start) < e && new Date(b.end) > s);
    const wl = db.state.waitlist.filter((w) => w.facilityId === facilityId && (w.status === "waiting" || w.status === "offered") && new Date(w.start) < e && new Date(w.end) > s).length;
    return { bookings: bookings.map((b) => toView(b, me.id)), waitlist: wl };
  },

  async createMaintenance(input: { facilityId: string; start: string; end: string; reason: string }) {
    const me = requirePermission("maintenance.manage");
    if (new Date(input.end) <= new Date(input.start)) throw new ApiError("VALIDATION", "The end time must be after the start time.");
    if (new Date(input.end) <= clock.now()) throw new ApiError("VALIDATION", "This window is already in the past.");
    if (input.reason.trim().length < 4) throw new ApiError("VALIDATION", "Add a short reason — affected students will see it.");
    return db.transaction(() => {
      const f = facilityOrThrow(input.facilityId);
      const m = closeWindow(me, f.id, new Date(input.start), new Date(input.end), input.reason.trim(), "planned");
      audit(me, "maintenance.create", "maintenance", m.id, f.name, `Scheduled maintenance ${enLabel(m)}: ${m.reason}. ${m.affectedBookingIds.length} bookings cancelled, students notified.`);
      return m;
    });
  },

  async cancelMaintenance(id: string) {
    const me = requirePermission("maintenance.manage");
    return db.transaction(() => {
      const m = db.state.maintenance.find((x) => x.id === id);
      if (!m) throw new ApiError("NOT_FOUND", "Maintenance window not found.");
      const now = clock.now();
      const next = new Date(m.start) > now ? { ...m, cancelled: true } : { ...m, end: now.toISOString() };
      db.put("maintenance", next);
      const f = facilityOrThrow(m.facilityId);
      audit(me, new Date(m.start) > now ? "maintenance.cancel" : "maintenance.end", "maintenance", m.id, f.name, new Date(m.start) > now ? "Cancelled scheduled maintenance — sessions reopened" : "Ended maintenance early — facility reopened");
      return next;
    });
  },

  /* ───────────── Waitlists ───────────── */
  async waitlists(): Promise<WaitlistSessionView[]> {
    requirePermission("waitlist.manage");
    const now = clock.now();
    const ix = engine();
    const users = new Map(db.state.users.map((x) => [x.id, x]));
    const groups = new Map<string, typeof db.state.waitlist>();
    for (const w of db.state.waitlist) {
      if (!(w.status === "waiting" || w.status === "offered") || new Date(w.start) <= now) continue;
      const k = `${w.facilityId}|${w.start}`;
      groups.set(k, [...(groups.get(k) ?? []), w]);
    }
    return [...groups.values()]
      .map((entries) => {
        const f = facilityOrThrow(entries[0].facilityId);
        const slot = findSession(f, entries[0].start);
        const sorted = entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const capacityTaken = slot ? ix.bookingsForFacility(f.id).filter((b) => b.start === entries[0].start && b.status !== "CANCELLED" && b.status !== "EXPIRED").length : 0;
        return {
          facility: f,
          category: db.state.categories.find((c) => c.id === f.categoryId)!,
          start: entries[0].start,
          end: entries[0].end,
          entries: sorted.map((w, i) => ({ ...w, user: toPublic(users.get(w.userId)), position: i + 1 })),
          remaining: Math.max(0, f.units - capacityTaken - sorted.filter((w) => w.status === "offered").length),
        };
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  },

  async removeWaitlistEntry(id: string) {
    const me = requirePermission("waitlist.manage");
    return db.transaction(() => {
      const w = db.state.waitlist.find((x) => x.id === id);
      if (!w) throw new ApiError("NOT_FOUND", "Entry not found.");
      db.put("waitlist", { ...w, status: "cancelled" });
      const f = facilityOrThrow(w.facilityId);
      notify(w.userId, "waitlist_expired", () => L("Removed from a waitlist", "تمت إزالتك من قائمة انتظار"), () => L(`The facilities office removed you from the ${f.name} waitlist for ${label(w)}.`, `أزالك مكتب إدارة المرافق من قائمة انتظار ${facilityName(f)} لموعد ${label(w)}.`));
      audit(me, "waitlist.remove", "waitlist", w.id, f.name, `Removed ${db.state.users.find((u) => u.id === w.userId)?.name} from the waitlist for ${enLabel(w)}`);
      if (w.status === "offered") offerNext(w.facilityId, w.start);
    });
  },

  async offerNextManually(facilityId: string, start: string) {
    requirePermission("waitlist.manage");
    return db.transaction(() => {
      const offered = offerNext(facilityId, start);
      if (!offered) throw new ApiError("CONFLICT", "There’s no free spot to offer for this session yet.");
      return offered;
    });
  },

  /* ───────────── Analytics ───────────── */
  async analytics(rangeDays: number): Promise<AnalyticsData> {
    requirePermission("analytics.view");
    const s = db.state;
    const today = startOfDay(clock.now());
    const from = addDays(today, -rangeDays);
    const prevFrom = addDays(from, -rangeDays);
    const facs = s.facilities;
    const cats = new Map(s.categories.map((c) => [c.id, c]));
    const daily: AnalyticsData["daily"] = [];
    const byFac = new Map<string, { booked: number; cap: number; ns: number; wl: number }>();
    const byCat = new Map<string, { booked: number; ns: number; cancel: number }>();
    const byHour = new Array(24).fill(0);
    let tot = { bookings: 0, attended: 0, noShows: 0, cancellations: 0, waitlistJoins: 0, cap: 0 };
    for (let i = 0; i < rangeDays; i++) {
      const day = addDays(from, i);
      const row = { day: format(day, "yyyy-MM-dd"), booked: 0, attended: 0, noShows: 0, cancellations: 0 };
      for (const f of facs) {
        const st = dayStat(f, day);
        row.booked += st.booked;
        row.attended += st.attended;
        row.noShows += st.noShows;
        row.cancellations += st.cancellations;
        tot.cap += st.capacity;
        tot.waitlistJoins += st.waitlistJoins;
        st.byHour.forEach((v, h) => (byHour[h] += v));
        const bf = byFac.get(f.id) ?? { booked: 0, cap: 0, ns: 0, wl: 0 };
        bf.booked += st.booked;
        bf.cap += st.capacity;
        bf.ns += st.noShows;
        bf.wl += st.waitlistJoins;
        byFac.set(f.id, bf);
        const bc = byCat.get(f.categoryId) ?? { booked: 0, ns: 0, cancel: 0 };
        bc.booked += st.booked;
        bc.ns += st.noShows;
        bc.cancel += st.cancellations;
        byCat.set(f.categoryId, bc);
      }
      tot.bookings += row.booked;
      tot.attended += row.attended;
      tot.noShows += row.noShows;
      tot.cancellations += row.cancellations;
      daily.push(row);
    }
    let prev = { booked: 0, cap: 0, ns: 0, cancel: 0 };
    for (let i = 0; i < rangeDays; i++) for (const f of facs) {
      const st = dayStat(f, addDays(prevFrom, i));
      prev.booked += st.booked;
      prev.cap += st.capacity;
      prev.ns += st.noShows;
      prev.cancel += st.cancellations;
    }
    // Student distribution & lead time from live records.
    const live = s.bookings.filter((b) => new Date(b.start) >= from && new Date(b.start) < today && b.status !== "CANCELLED");
    const perStudent = new Map<string, number>();
    let leadSum = 0;
    for (const b of live) {
      perStudent.set(b.userId, (perStudent.get(b.userId) ?? 0) + 1);
      leadSum += (new Date(b.start).getTime() - new Date(b.createdAt).getTime()) / 3600000;
    }
    const buckets = [
      { bucket: "1", min: 1, max: 1 },
      { bucket: "2–3", min: 2, max: 3 },
      { bucket: "4–6", min: 4, max: 6 },
      { bucket: "7–10", min: 7, max: 10 },
      { bucket: "11+", min: 11, max: Infinity },
    ].map((b) => ({ bucket: b.bucket, students: [...perStudent.values()].filter((v) => v >= b.min && v <= b.max).length }));

    const byFacility = facs
      .map((f) => {
        const v = byFac.get(f.id)!;
        return { facilityId: f.id, name: facilityName(f), color: cats.get(f.categoryId)?.color ?? "#888", utilization: v.cap ? v.booked / v.cap : 0, bookings: v.booked, noShowRate: v.booked ? v.ns / v.booked : 0, waitlist: v.wl };
      })
      .filter((x) => x.bookings > 0)
      .sort((a, b) => b.utilization - a.utilization);
    const byCategory = [...byCat.entries()]
      .map(([id, v]) => ({ categoryId: id, name: cats.get(id) ? facilityName(cats.get(id)!) : id, color: cats.get(id)?.color ?? "#888", bookings: v.booked, noShowRate: v.booked ? v.ns / v.booked : 0, cancellationRate: v.booked + v.cancel ? v.cancel / (v.booked + v.cancel) : 0 }))
      .sort((a, b) => b.bookings - a.bookings);

    const heat = heatmapFor(facs.filter((f) => f.status === "active"), from, rangeDays);
    const insights: AnalyticsData["insights"] = [];
    const top = byFacility[0];
    if (top && top.utilization > 0.6) insights.push({ tone: "warning", text: L(`${top.name} runs at ${pct(top.utilization)}% utilisation${top.waitlist ? ` with ${top.waitlist} waitlist joins` : ""}. Consider extending evening hours or adding sessions.`, `إشغال ${top.name} يصل إلى ${pct(top.utilization)}%${top.waitlist ? ` مع ${top.waitlist} انضمام لقوائم الانتظار` : ""}. فكّر في مد ساعات المساء أو إضافة مواعيد.`) });
    const peak = [...heat].sort((a, b) => b.value - a.value)[0];
    if (peak) insights.push({ tone: "info", text: L(`Peak demand is ${["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][peak.weekday]} around ${String(peak.hour).padStart(2, "0")}:00 — ${pct(peak.value)}% of capacity booked.`, `ذروة الطلب يوم ${["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"][peak.weekday]} حوالي الساعة ${String(peak.hour).padStart(2, "0")}:00 — ${pct(peak.value)}% من السعة محجوزة.`) });
    const worstNs = [...byCategory].sort((a, b) => b.noShowRate - a.noShowRate)[0];
    if (worstNs) insights.push({ tone: worstNs.noShowRate > 0.05 ? "warning" : "success", text: L(`${worstNs.name} has the highest no-show rate at ${pct(worstNs.noShowRate)}%. ${worstNs.noShowRate > 0.05 ? "A shorter grace period or reminder nudge could help." : "No action needed."}`, `${worstNs.name} لديه أعلى نسبة غياب (${pct(worstNs.noShowRate)}%). ${worstNs.noShowRate > 0.05 ? "فترة سماح أقصر أو تذكير إضافي قد يساعد." : "لا يلزم أي إجراء."}`) });
    const low = [...byFacility].filter((f) => f.utilization < 0.3).sort((a, b) => a.utilization - b.utilization)[0];
    if (low) insights.push({ tone: "info", text: L(`${low.name} is under-used (${pct(low.utilization)}%). Promoting it to students could balance demand.`, `${low.name} غير مستغل بشكل كافٍ (${pct(low.utilization)}%). الترويج له بين الطلاب قد يوازن الطلب.`) });

    return {
      rangeDays,
      totals: { bookings: tot.bookings, attended: tot.attended, noShows: tot.noShows, cancellations: tot.cancellations, waitlistJoins: tot.waitlistJoins, utilization: tot.cap ? tot.bookings / tot.cap : 0, uniqueStudents: perStudent.size, avgLeadHours: live.length ? leadSum / live.length : 0 },
      prevTotals: { bookings: prev.booked, utilization: prev.cap ? prev.booked / prev.cap : 0, noShowRate: prev.booked ? prev.ns / prev.booked : 0, cancellationRate: prev.booked + prev.cancel ? prev.cancel / (prev.booked + prev.cancel) : 0 },
      daily,
      byFacility,
      byCategory,
      heatmap: heat,
      byHour,
      studentDistribution: buckets,
      insights,
    };
  },

  /* ───────────── Audit ───────────── */
  async audit(q: AuditQuery) {
    requirePermission("audit.view");
    const term = q.q?.trim().toLowerCase();
    const rows = [...db.state.audit]
      .filter((a) => (!q.role || a.actorRole === q.role) && (!q.entityType || a.entityType === q.entityType))
      .filter((a) => !term || a.summary.toLowerCase().includes(term) || a.actorName.toLowerCase().includes(term) || a.entityId.toLowerCase().includes(term) || a.action.includes(term))
      .sort((a, b) => b.at.localeCompare(a.at));
    return paginate(rows, q.page, q.pageSize ?? 30);
  },

  /* ───────────── Settings, roles & team ───────────── */
  async settings() {
    requirePermission("settings.manage");
    return { settings: db.state.settings, roles: db.state.roles };
  },

  async updateSettings(patch: Partial<SystemSettings>, summary: string) {
    const u = currentUser();
    const securityKeys: (keyof SystemSettings)[] = ["qrRotationSeconds", "sessionTimeoutMinutes", "bookingRateLimitPerMinute", "allowedEmailDomains", "maxDevicesPerStudent"];
    const touchesSecurity = Object.keys(patch).some((k) => securityKeys.includes(k as keyof SystemSettings));
    requirePermission(touchesSecurity ? "security.manage" : "settings.manage");
    return db.transaction(() => {
      const next = { ...db.state.settings, ...patch };
      db.setSingleton("settings", next);
      audit(u, "settings.update", "settings", touchesSecurity ? "security" : "general", touchesSecurity ? "Security" : "General", summary);
      return next;
    });
  },

  async updateRole(key: RoleKey, permissions: Permission[]) {
    const u = requirePermission("role.manage");
    if (key === "super_admin") throw new ApiError("FORBIDDEN", "Super admin permissions are fixed so nobody can lock themselves out.");
    return db.transaction(() => {
      const roles = db.state.roles.map((r) => (r.key === key ? { ...r, permissions } : r));
      const before = db.state.roles.find((r) => r.key === key)!;
      const added = permissions.filter((p) => !before.permissions.includes(p));
      const removed = before.permissions.filter((p) => !permissions.includes(p));
      db.setSingleton("roles", roles);
      audit(u, "role.update", "role", key, before.name, [added.length ? `Granted ${added.join(", ")}` : "", removed.length ? `Revoked ${removed.join(", ")}` : ""].filter(Boolean).join("; ") || "No changes");
      return roles;
    });
  },

  async team(): Promise<TeamMember[]> {
    requirePermission("staff.manage");
    const facs = new Map(db.state.facilities.map((f) => [f.id, f.name]));
    return db.state.users.filter((u) => u.role !== "student").map((u) => ({ ...u, facilityNames: (u.assignedFacilityIds ?? []).map((id) => facs.get(id) ?? id) }));
  },

  /** A new temporary password for a student or team member, to hand over in person. */
  async resetPassword(userId: string): Promise<{ password: string }> {
    const target = db.state.users.find((u) => u.id === userId);
    if (!target) throw new ApiError("NOT_FOUND", "Student not found.");
    const me = requirePermission(target.role === "student" ? "student.manage" : target.role === "staff" ? "staff.manage" : "admin.manage");
    return { password: await setTemporaryPassword(me, target) };
  },

  async saveMember(input: { id?: string; name: string; email: string; title: string; role: RoleKey; assignedFacilityIds: string[]; status: User["status"] }): Promise<User & { tempPassword?: string }> {
    const me = currentUser();
    if (input.role === "student") throw new ApiError("VALIDATION", "Students create their own accounts. Add only staff and administrators here.");
    const existing = input.id ? db.state.users.find((u) => u.id === input.id) : undefined;
    if (input.id && !existing) throw new ApiError("NOT_FOUND", "Student not found.");
    if (existing?.role === "student") throw new ApiError("FORBIDDEN", "Student accounts can’t be changed from the team page.");
    // Touching an administrator — as they are now or as they'd become — needs the admin permission,
    // so nobody can demote, rename or suspend someone above them.
    const touchesAdmin = [input.role, existing?.role].some((r) => r === "admin" || r === "super_admin");
    requirePermission(touchesAdmin ? "admin.manage" : "staff.manage");
    const domains = db.state.settings.allowedEmailDomains.map((d) => "@" + d);
    if (!/^[^@\s]+@[^@\s]+$/.test(input.email.trim()) || !domainAllowed(input.email.trim().toLowerCase())) throw new ApiError("VALIDATION", L(`Use a university email address ending in ${domains.join(" or ")}.`, `استخدم بريدًا جامعيًا ينتهي بـ ${domains.join(" أو ")}.`));
    if (input.name.trim().length < 3) throw new ApiError("VALIDATION", "Enter the person’s full name.");
    const saved = await db.transaction(() => {
      if (db.state.users.some((u) => u.id !== existing?.id && u.email.toLowerCase() === input.email.trim().toLowerCase())) throw new ApiError("CONFLICT", "Someone already uses this email address.");
      if (existing?.id === me.id && (input.role !== existing.role || input.status !== existing.status)) throw new ApiError("FORBIDDEN", "You can’t change your own role.");
      if (existing?.role === "super_admin" && (input.role !== "super_admin" || input.status !== "active") && !db.state.users.some((u) => u.id !== existing.id && u.role === "super_admin" && u.status === "active")) {
        throw new ApiError("FORBIDDEN", "Keep at least one active super admin.");
      }
      const u: User = {
        ...(existing ?? { id: `u_team_${db.nextSeq()}`, avatarHue: Math.floor(Math.random() * 360), createdAt: clock.now().toISOString(), audience: "staff" as const }),
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        title: input.title.trim(),
        role: input.role,
        assignedFacilityIds: input.assignedFacilityIds,
        status: input.status,
      };
      db.put("users", u);
      audit(me, existing ? "user.update" : "user.invite", "user", u.id, u.name, existing ? `Updated ${u.name} (${u.role.replace("_", " ")})` : `Added ${u.name} as ${u.role.replace("_", " ")}`);
      return { u, isNew: !existing };
    });
    // New team members get a temporary password to sign in with.
    return saved.isNew ? { ...saved.u, tempPassword: await setTemporaryPassword(me, saved.u) } : saved.u;
  },

};

