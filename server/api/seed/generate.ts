import { addDays, format, startOfDay } from "date-fns";
import { sessionTimes } from "@/domain/engine/sessions";
import { resolvePolicy } from "@/domain/policy";
import type {
  AppNotification,
  AuditLog,
  Booking,
  BookingPolicy,
  DailyStat,
  Facility,
  FacilityCategory,
  FacilityIssue,
  FairnessFlag,
  Favorite,
  MaintenancePeriod,
  Restriction,
  User,
  WaitlistEntry,
} from "@/domain/types";
import type { DbState } from "../state";
import { CATEGORIES, FACILITIES, GLOBAL_POLICY, ROLES, SETTINGS } from "./catalog";
import { SPECIAL_STUDENTS, buildUsers, mulberry32, pick, randInt, type Rng } from "./people";

const MIN = 60_000;
const HOUR = 60 * MIN;
const SEMESTER_START = new Date(2026, 8, 13);

const POPULARITY: Record<string, number> = {
  f_football: 1,
  f_padel: 1.05,
  f_tennis: 0.7,
  f_volleyball: 0.55,
  f_pingpong: 0.7,
  f_billiards: 0.8,
  f_airhockey: 0.6,
};

function hourCurve(motif: string, hour: number): number {
  switch (motif) {
    case "football":
    case "volleyball":
    case "tennis":
    case "padel":
      return hour < 10 ? 0.22 : hour < 15 ? 0.32 : hour < 17 ? 0.58 : hour < 22 ? 0.95 : 0.55;
    case "tabletennis":
    case "billiards":
    case "airhockey":
      return hour < 12 ? 0.3 : hour < 15 ? 0.62 : hour < 18 ? 0.88 : 0.7;
    default:
      return 0.5;
  }
}

function dayFactor(kind: string, weekday: number): number {
  const weekend = weekday === 5 || weekday === 6;
  if (kind === "academic") return weekend ? 0.45 : 1;
  if (kind === "sports") return weekday === 5 ? 0.85 : 1;
  return weekend ? 0.8 : 1;
}

function demand(f: Facility, cat: FacilityCategory, start: Date, daysAhead: number): number {
  const season = start < SEMESTER_START ? 0.35 : 1;
  const decay = daysAhead <= 0 ? 1 : daysAhead === 1 ? 0.86 : daysAhead === 2 ? 0.62 : daysAhead === 3 ? 0.42 : 0.24;
  return Math.min(1, (POPULARITY[f.id] ?? 0.5) * hourCurve(f.media.motif, start.getHours()) * dayFactor(cat.kind, start.getDay()) * season * decay);
}

interface Placed {
  s: number;
  e: number;
  scope: string;
}

export function createSeed(anchorISO: string): DbState {
  const anchor = new Date(anchorISO);
  const A = anchor.getTime();
  const D0 = startOfDay(anchor);
  const rng: Rng = mulberry32(20260924);

  const users = buildUsers(rng, 460);
  const userById = new Map(users.map((u) => [u.id, u]));
  const facById = new Map(FACILITIES.map((f) => [f.id, f]));
  const catById = new Map(CATEGORIES.map((c) => [c.id, c]));
  const policyOf = new Map<string, BookingPolicy>(FACILITIES.map((f) => [f.id, resolvePolicy(GLOBAL_POLICY, catById.get(f.categoryId), f)]));
  const scopeOf = (f: Facility) => (policyOf.get(f.id)!.fairness.scope === "category" ? f.categoryId : f.id);
  const staffFor = new Map<string, string>();
  for (const u of users) if (u.role === "staff") for (const fid of u.assignedFacilityIds ?? []) if (!staffFor.has(fid)) staffFor.set(fid, u.id);

  const specialIds = new Set(SPECIAL_STUDENTS.map((s) => s.id));
  const pool = users.filter((u) => u.role === "student" && !specialIds.has(u.id));
  const reliability = new Map<string, number>();
  for (const u of users) {
    const r = rng();
    reliability.set(u.id, r < 0.8 ? 0.008 : r < 0.95 ? 0.05 : 0.14);
  }
  reliability.set("u_yehia", 0);

  // Weighted picker — a few students are far more active than others.
  const weights = pool.map(() => 0.25 + rng() ** 2 * 2.5);
  const cum: number[] = [];
  weights.reduce((acc, w, i) => (cum[i] = acc + w), 0);
  const total = cum[cum.length - 1];
  const pickWeighted = (): User => {
    const x = rng() * total;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return pool[lo];
  };

  // Stable groups: team squads & racket groups.
  const shuffled = [...pool].sort(() => rng() - 0.5);
  const squads: string[][] = [];
  for (let i = 0; i < 14; i++) squads.push(shuffled.slice(i * 9, i * 9 + 9).map((u) => u.id));
  const racketGroups: string[][] = [];
  const shuffled2 = [...pool].sort(() => rng() - 0.5);
  for (let i = 0; i < 40; i++) racketGroups.push(shuffled2.slice(i * 4, i * 4 + 4).map((u) => u.id));

  /* ── Occupancy & per-person bookkeeping ── */
  const personDay = new Map<string, Placed[]>();
  const pdKey = (uid: string, s: number) => `${uid}|${startOfDay(new Date(s)).getTime()}`;
  const canPlace = (uid: string, s: number, e: number, f: Facility) => {
    const arr = personDay.get(pdKey(uid, s));
    if (!arr) return true;
    const pol = policyOf.get(f.id)!;
    const scope = scopeOf(f);
    const rest = pol.fairness.restMinutes * MIN;
    let count = 0;
    for (const x of arr) {
      if (s < x.e + 20 * MIN && x.s < e + 20 * MIN) return false;
      if (x.scope === scope) {
        count++;
        if (Math.abs(s - x.e) < rest || Math.abs(x.s - e) < rest) return false;
      }
    }
    return count < pol.limits.perDay;
  };
  const place = (uid: string, s: number, e: number, f: Facility) => {
    const k = pdKey(uid, s);
    const arr = personDay.get(k);
    const v = { s, e, scope: scopeOf(f) };
    if (arr) arr.push(v);
    else personDay.set(k, [v]);
  };
  const occUnits = new Map<string, Set<number>>();
  const occCount = new Map<string, number>();
  const sKey = (fid: string, s: number) => `${fid}|${s}`;

  const bookings: Booking[] = [];
  const reservedEmpty = new Set<string>();
  const maintenance: MaintenancePeriod[] = [];
  const maintenanceVictims = new Map<MaintenancePeriod, Booking[]>();

  const sessionNear = (fid: string, dayOffset: number, hm: string) => {
    const f = facById.get(fid)!;
    const day = addDays(D0, dayOffset);
    const [h, m] = hm.split(":").map(Number);
    const target = new Date(day);
    target.setHours(h, m, 0, 0);
    const list = sessionTimes(f, day);
    if (list.length === 0) return null;
    return list.reduce((best, x) => (Math.abs(x.start.getTime() - target.getTime()) < Math.abs(best.start.getTime() - target.getTime()) ? x : best));
  };
  const openDayFrom = (fid: string, fromOffset: number) => {
    const f = facById.get(fid)!;
    for (let d = fromOffset; d < fromOffset + 7; d++) if (f.schedule[addDays(D0, d).getDay()]) return d;
    return fromOffset;
  };

  const iso = (ms: number) => new Date(ms).toISOString();

  function mk(fid: string, s: Date, e: Date, userId: string, participants: string[], createdAt: number, extra: Partial<Booking> = {}): Booking {
    const f = facById.get(fid)!;
    const k = sKey(fid, s.getTime());
    let unitIndex = extra.unitIndex ?? 0;
    if (f.mode === "exclusive") {
      const used = occUnits.get(k) ?? new Set<number>();
      while (used.has(unitIndex)) unitIndex++;
      used.add(unitIndex);
      occUnits.set(k, used);
    } else {
      occCount.set(k, (occCount.get(k) ?? 0) + 1);
    }
    for (const uid of [userId, ...participants]) place(uid, s.getTime(), e.getTime(), f);
    const b: Booking = {
      id: "",
      facilityId: fid,
      userId,
      unitIndex,
      start: s.toISOString(),
      end: e.toISOString(),
      status: "CONFIRMED",
      participants: participants.map((p) => ({ userId: p })),
      source: "student",
      createdAt: iso(createdAt),
      updatedAt: iso(createdAt),
      version: 1,
      ...extra,
    };
    b.unitIndex = unitIndex;
    bookings.push(b);
    return b;
  }

  const completed = (b: Booking, method: "qr" | "manual" = "qr") => {
    const s = new Date(b.start).getTime();
    const at = s - randInt(rng, 0, 12) * MIN + randInt(rng, 0, 9) * MIN;
    b.status = "COMPLETED";
    b.checkIn = { at: iso(at), byUserId: staffFor.get(b.facilityId) ?? "u_staff_karim", method, headcount: b.participants.length ? b.participants.length + 1 - (rng() < 0.3 ? 1 : 0) : undefined };
    b.updatedAt = iso(new Date(b.end).getTime());
    b.version = 3;
    return b;
  };
  const noShow = (b: Booking) => {
    const pol = policyOf.get(b.facilityId)!;
    b.status = "NO_SHOW";
    b.noShow = { at: iso(new Date(b.start).getTime() + pol.checkIn.graceMinutes * MIN), byUserId: "system", auto: true };
    b.updatedAt = b.noShow.at;
    b.version = 2;
    return b;
  };
  const cancel = (b: Booking, at: number, byUserId: string, reason: string, byRole: User["role"] = "student") => {
    const pol = policyOf.get(b.facilityId)!;
    const late = new Date(b.start).getTime() - at < pol.cancellation.freeUntilMinutes * MIN;
    b.status = "CANCELLED";
    b.cancellation = { at: iso(at), byUserId, reason, late: byRole === "student" && late, penalty: byRole === "student" && late && pol.cancellation.lateCountsAsStrike, byRole };
    b.updatedAt = iso(at);
    b.version = 2;
    // Free the space for the random generator.
    const k = sKey(b.facilityId, new Date(b.start).getTime());
    const f = facById.get(b.facilityId)!;
    if (f.mode === "exclusive") occUnits.get(k)?.delete(b.unitIndex);
    else occCount.set(k, Math.max(0, (occCount.get(k) ?? 1) - 1));
    return b;
  };

  const S = (fid: string, d: number, hm: string) => sessionNear(fid, d, hm)!;
  const before = (s: Date, hours: number) => s.getTime() - hours * HOUR;

  /* ─────────────────────── Maintenance windows ─────────────────────── */
  const maint = (fid: string, d: number, from: string, to: string, reason: string, kind: MaintenancePeriod["kind"], createdBy: string, createdOffsetH: number) => {
    const day = addDays(D0, d);
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm] = to.split(":").map(Number);
    const s = new Date(day);
    s.setHours(fh, fm, 0, 0);
    const e = new Date(day);
    e.setHours(th, tm, 0, 0);
    const m: MaintenancePeriod = { id: `MT-${String(maintenance.length + 101)}`, facilityId: fid, start: s.toISOString(), end: e.toISOString(), reason, kind, createdBy, createdAt: iso(s.getTime() - createdOffsetH * HOUR), affectedBookingIds: [] };
    maintenance.push(m);
    return m;
  };
  const mtBilliards = maint("f_billiards", openDayFrom("f_billiards", 2), "12:00", "16:00", "Table re-felting", "planned", "u_admin_nour", 72);
  maint("f_pingpong", openDayFrom("f_pingpong", -6), "10:00", "12:00", "New nets and paddles installed", "planned", "u_admin_nour", 120);
  const mtFoot = maint("f_football", -4, "20:00", "22:00", "Floodlight failure on the north side", "staff_closure", "u_staff_karim", 0.4);
  maint("f_volleyball", 5, "08:00", "12:00", "Court line repainting", "planned", "u_admin_dina", 50);
  const inMaintenance = (fid: string, s: number, e: number) => maintenance.some((m) => m.facilityId === fid && s < new Date(m.end).getTime() && new Date(m.start).getTime() < e);

  /* ─────────────────────── Scenario: Yehia ─────────────────────── */
  const Y = "u_yehia";
  const scen: Record<string, Booking> = {};
  const squadY = ["u_omar", "u_youssef", "u_seif", "u_ziad", "u_adham", "u_marwan"];
  {
    let x = S("f_football", -12, "19:00");
    scen.y1 = completed(mk("f_football", x.start, x.end, Y, squadY, before(x.start, 30)));
    x = S("f_volleyball", -8, "20:00");
    scen.y2 = completed(mk("f_volleyball", x.start, x.end, "u_omar", [Y, "u_youssef", "u_hussein", "u_karim_adel", "u_ziad", "u_seif"], before(x.start, 40)));
    x = S("f_football", -5, "18:00");
    scen.y3 = completed(mk("f_football", x.start, x.end, "u_omar", [Y, "u_marwan", "u_adham", "u_seif", "u_youssef", "u_hussein"], before(x.start, 50)));
    x = S("f_volleyball", -2, "19:00");
    scen.y4 = completed(mk("f_volleyball", x.start, x.end, Y, ["u_omar", "u_ziad", "u_karim_adel", "u_marwan", "u_adham", "u_youssef"], before(x.start, 28)));
    x = S("f_pingpong", openDayFrom("f_pingpong", -10), "12:00");
    scen.y5 = noShow(mk("f_pingpong", x.start, x.end, Y, [], before(x.start, 11)));
    x = S("f_tennis", -6, "17:00");
    scen.y6 = cancel(mk("f_tennis", x.start, x.end, Y, ["u_salma"], before(x.start, 52)), before(x.start, 21), Y, "Plans changed");
    x = S("f_billiards", openDayFrom("f_billiards", -3), "15:00");
    scen.y7 = completed(mk("f_billiards", x.start, x.end, Y, ["u_omar"], before(x.start, 14)));
    x = S("f_airhockey", openDayFrom("f_airhockey", -1), "14:00");
    scen.y8 = completed(mk("f_airhockey", x.start, x.end, Y, ["u_youssef"], before(x.start, 6)), "manual");
    x = S("f_pingpong", openDayFrom("f_pingpong", -4), "16:30");
    scen.y9 = completed(mk("f_pingpong", x.start, x.end, Y, [], before(x.start, 6)));
    x = S("f_padel", -7, "20:00");
    scen.y11 = completed(mk("f_padel", x.start, x.end, Y, ["u_omar", "u_salma", "u_mariam"], before(x.start, 45)));

    // Upcoming: ping-pong later today (or on the next open day).
    const pp = facById.get("f_pingpong")!;
    let up = sessionTimes(pp, D0).find((s) => s.start.getTime() >= A + 75 * MIN);
    if (!up) up = S("f_pingpong", openDayFrom("f_pingpong", 1), "13:00");
    scen.yPing = mk("f_pingpong", up.start, up.end, Y, [], A - 3 * HOUR - 12 * MIN);

    // Upcoming: football tomorrow 18:00 with the squad.
    x = S("f_football", 1, "18:00");
    scen.yFootball = mk("f_football", x.start, x.end, Y, squadY, A - 20 * HOUR - 46 * MIN);
    reservedEmpty.add(sKey("f_football", S("f_football", 1, "19:00").start.getTime()));
  }

  /* Omar's booking the day after — used to demonstrate linked-group detection. */
  {
    const x = S("f_football", 2, "19:00");
    const outsiders = pool.filter((u) => canPlace(u.id, x.start.getTime(), x.end.getTime(), facById.get("f_football")!)).slice(40, 44).map((u) => u.id);
    scen.omarD2 = mk("f_football", x.start, x.end, "u_omar", ["u_hussein", "u_karim_adel", ...outsiders], A - 9 * HOUR);
    reservedEmpty.add(sKey("f_football", S("f_football", 2, "20:00").start.getTime()));
  }

  /* ─────────────────────── Scenario: Ahmed & Mohamed ─────────────────────── */
  {
    let x = S("f_football", -13, "20:00");
    scen.am1 = completed(mk("f_football", x.start, x.end, "u_ahmed", ["u_mohamed", "u_ali", "u_hamza", "u_amr", "u_belal"], before(x.start, 30)));
    x = S("f_volleyball", -9, "19:00");
    scen.am2 = completed(mk("f_volleyball", x.start, x.end, "u_mohamed", ["u_ahmed", "u_eyad", "u_moaz", "u_ali", "u_hamza"], before(x.start, 26)));
    x = S("f_volleyball", -6, "18:00");
    scen.am3 = completed(mk("f_volleyball", x.start, x.end, "u_ahmed", ["u_mohamed", "u_belal", "u_amr", "u_eyad", "u_ali"], before(x.start, 20)));
    x = S("f_football", -2, "18:00");
    scen.am4 = completed(mk("f_football", x.start, x.end, "u_ahmed", ["u_ali", "u_hamza", "u_amr", "u_belal", "u_eyad"], before(x.start, 49)));
    const y = S("f_football", -2, "19:00");
    const others = pool.filter((u) => canPlace(u.id, y.start.getTime(), y.end.getTime(), facById.get("f_football")!)).slice(60, 65).map((u) => u.id);
    scen.am5 = completed(mk("f_football", y.start, y.end, "u_mohamed", ["u_moaz", ...others], before(y.start, 47)));
  }

  /* ─────────────────────── Scenario: strikes & restrictions ─────────────────────── */
  {
    let x = S("f_pingpong", openDayFrom("f_pingpong", -13), "11:00");
    scen.r1 = noShow(mk("f_pingpong", x.start, x.end, "u_rana", [], before(x.start, 20)));
    x = S("f_billiards", openDayFrom("f_billiards", -9), "12:15");
    scen.r2 = noShow(mk("f_billiards", x.start, x.end, "u_rana", [], before(x.start, 30)));
    x = S("f_airhockey", openDayFrom("f_airhockey", -4), "18:00");
    scen.r3 = noShow(mk("f_airhockey", x.start, x.end, "u_rana", [], before(x.start, 22)));
    x = S("f_pingpong", openDayFrom("f_pingpong", -7), "13:00");
    completed(mk("f_pingpong", x.start, x.end, "u_rana", [], before(x.start, 40)));
    x = S("f_billiards", openDayFrom("f_billiards", -11), "11:30");
    scen.n1 = noShow(mk("f_billiards", x.start, x.end, "u_nadine", [], before(x.start, 50)));
    x = S("f_airhockey", openDayFrom("f_airhockey", -3), "17:00");
    scen.n2 = noShow(mk("f_airhockey", x.start, x.end, "u_nadine", [], before(x.start, 5)));
    x = S("f_pingpong", openDayFrom("f_pingpong", -5), "14:00");
    completed(mk("f_pingpong", x.start, x.end, "u_nadine", [], before(x.start, 20)));
    // Hana: repeated late cancellations on padel.
    for (const d of [-12, -6, -2]) {
      const p = S("f_padel", d, "18:30");
      const b = mk("f_padel", p.start, p.end, "u_hana", ["u_farida"], before(p.start, 30));
      cancel(b, before(p.start, 1 + rng()), "u_hana", pick(rng, ["Can’t make it", "Exam moved", "Partner cancelled"]));
      scen[`h${d}`] = b;
    }
  }

  /* ─────────────────────── Scenario: full sessions & waitlists ─────────────────────── */
  const waitlist: WaitlistEntry[] = [];
  const wl = (fid: string, s: Date, e: Date, userId: string, createdAt: number, extra: Partial<WaitlistEntry> = {}) => {
    const w: WaitlistEntry = { id: `WL-${String(3000 + waitlist.length)}`, facilityId: fid, start: s.toISOString(), end: e.toISOString(), userId, createdAt: iso(createdAt), status: "waiting", ...extra };
    waitlist.push(w);
    return w;
  };
  const freeStudents = (f: Facility, s: Date, e: Date, n: number, offset: number) =>
    pool
      .slice(offset)
      .filter((u) => canPlace(u.id, s.getTime(), e.getTime(), f))
      .slice(0, n)
      .map((u) => u.id);
  let offerEntry: WaitlistEntry;
  {
    // Padel D+2 20:00: both courts full, Yehia is #3 in the queue.
    const padel = facById.get("f_padel")!;
    const x = S("f_padel", 2, "20:00");
    let g = freeStudents(padel, x.start, x.end, 4, 120);
    mk("f_padel", x.start, x.end, g[0], g.slice(1), A - 30 * HOUR);
    g = freeStudents(padel, x.start, x.end, 2, 150);
    mk("f_padel", x.start, x.end, g[0], g.slice(1), A - 28 * HOUR);
    const q = freeStudents(padel, x.start, x.end, 2, 200);
    wl("f_padel", x.start, x.end, q[0], A - 27 * HOUR);
    wl("f_padel", x.start, x.end, q[1], A - 24 * HOUR);
    wl("f_padel", x.start, x.end, Y, A - 19 * HOUR - 55 * MIN);

    // Tennis D+1 20:00: the court was just freed and offered to Yehia.
    const tennis = facById.get("f_tennis")!;
    const t = S("f_tennis", 1, "20:00");
    const hana = mk("f_tennis", t.start, t.end, "u_hana", ["u_farida"], A - 29 * HOUR);
    cancel(hana, A - 7 * MIN, "u_hana", "Exam moved to tomorrow evening");
    scen.hanaTennis = hana;
    const claim = policyOf.get("f_tennis")!.waitlist.claimMinutes;
    offerEntry = wl("f_tennis", t.start, t.end, Y, A - 22 * HOUR, { status: "offered", offeredAt: iso(A - 6 * MIN), offerExpiresAt: iso(A - 6 * MIN + claim * MIN) });
    wl("f_tennis", t.start, t.end, freeStudents(tennis, t.start, t.end, 1, 300)[0], A - 18 * HOUR);
    // Hold the court for the offer so the random generator leaves it empty.
    reservedEmpty.add(sKey("f_tennis", t.start.getTime()));
  }

  /* ─────────────────────── Maintenance casualties ─────────────────────── */
  {
    const bil = facById.get("f_billiards")!;
    const ms = new Date(mtBilliards.start).getTime();
    const me = new Date(mtBilliards.end).getTime();
    const affected = sessionTimes(bil, new Date(mtBilliards.start)).filter((s) => s.start.getTime() < me && s.end.getTime() > ms);
    const victims: Booking[] = [];
    affected.slice(0, 3).forEach((s, i) => {
      const [u] = freeStudents(bil, s.start, s.end, 1, 330 + i * 7);
      const b = mk("f_billiards", s.start, s.end, u, [], new Date(mtBilliards.createdAt).getTime() - (20 + i * 9) * HOUR);
      cancel(b, new Date(mtBilliards.createdAt).getTime(), "u_admin_nour", "Facility maintenance: table re-felting", "admin");
      victims.push(b);
    });
    maintenanceVictims.set(mtBilliards, victims);
    const fb = facById.get("f_football")!;
    const fs = sessionTimes(fb, new Date(mtFoot.start)).filter((s) => s.start.getTime() >= new Date(mtFoot.start).getTime() && s.start.getTime() < new Date(mtFoot.end).getTime());
    const fv: Booking[] = [];
    for (const s of fs.slice(0, 2)) {
      const sq = squads[fv.length + 3];
      const b = mk("f_football", s.start, s.end, sq[0], sq.slice(1, 7), before(s.start, 40));
      cancel(b, new Date(mtFoot.createdAt).getTime(), "u_staff_karim", "Facility closed: floodlight failure", "staff");
      fv.push(b);
    }
    maintenanceVictims.set(mtFoot, fv);
  }

  /* ─────────────────────── Random campus activity ─────────────────────── */
  const scenarioBookings = new Set(bookings);
  for (const f of FACILITIES) {
    if (f.status !== "active") continue;
    const cat = catById.get(f.categoryId)!;
    const pol = policyOf.get(f.id)!;
    for (let d = -14; d <= Math.min(7, pol.window.advanceDays); d++) {
      const day = addDays(D0, d);
      for (const { start, end } of sessionTimes(f, day)) {
        const s = start.getTime();
        const e = end.getTime();
        const k = sKey(f.id, s);
        if (reservedEmpty.has(k) || inMaintenance(f.id, s, e)) continue;
        const p = demand(f, cat, start, d);
        const createdAtFor = () => {
          const lead = (0.5 + rng() * Math.max(1, pol.window.advanceDays) * 22) * HOUR;
          const c = s - lead;
          return c > A ? A - randInt(rng, 5, 600) * MIN : c;
        };
        if (f.mode === "exclusive") {
          for (let u = 0; u < f.units; u++) {
            if (occUnits.get(k)?.has(u)) continue;
            if (rng() > p) continue;
            if (pol.participants.required) {
              const groups = f.categoryId === "cat_team" ? squads : racketGroups;
              const g = pick(rng, groups);
              const members = [...g].sort(() => rng() - 0.5).filter((id) => canPlace(id, s, e, f));
              const want = randInt(rng, pol.participants.min, Math.min(pol.participants.max, f.capacity, g.length));
              if (members.length < pol.participants.min) continue;
              const chosen = members.slice(0, want);
              mk(f.id, start, end, chosen[0], chosen.slice(1), createdAtFor());
            } else {
              let booker: User | undefined;
              for (let tries = 0; tries < 8 && !booker; tries++) {
                const c = pickWeighted();
                if (canPlace(c.id, s, e, f)) booker = c;
              }
              if (!booker) continue;
              mk(f.id, start, end, booker.id, [], createdAtFor());
            }
          }
        } else {
          const target = Math.min(f.units, Math.round(f.units * Math.max(0, Math.min(1, p + (rng() - 0.5) * 0.25))));
          let cur = occCount.get(k) ?? 0;
          let guard = 0;
          while (cur < target && guard++ < target * 3) {
            const c = pickWeighted();
            if (!canPlace(c.id, s, e, f)) continue;
            mk(f.id, start, end, c.id, [], createdAtFor());
            cur++;
          }
        }
      }
    }
  }

  /* ─────────────────────── Settle statuses of random bookings ─────────────────────── */
  for (const b of bookings) {
    if (scenarioBookings.has(b) || b.status !== "CONFIRMED") continue;
    const s = new Date(b.start).getTime();
    const e = new Date(b.end).getTime();
    const pol = policyOf.get(b.facilityId)!;
    const created = new Date(b.createdAt).getTime();
    if (rng() < 0.075) {
      const upper = Math.min(s - 10 * MIN, A - MIN);
      if (upper > created) {
        cancel(b, created + rng() * (upper - created), b.userId, pick(rng, ["Plans changed", "Class rescheduled", "Not feeling well", "Booked by mistake", "Exam preparation"]));
        continue;
      }
    }
    if (e <= A) {
      if (rng() < (reliability.get(b.userId) ?? 0.01)) noShow(b);
      else completed(b, rng() < 0.85 ? "qr" : "manual");
    } else if (s <= A) {
      const graceOver = A - s > pol.checkIn.graceMinutes * MIN;
      if (rng() < (graceOver ? 0.93 : 0.6)) {
        b.status = "CHECKED_IN";
        b.checkIn = { at: iso(s - randInt(rng, 0, 10) * MIN + randInt(rng, 0, 6) * MIN), byUserId: staffFor.get(b.facilityId) ?? "u_staff_karim", method: "qr" };
        b.version = 2;
      }
    }
  }

  /* ─────────────────────── Booking IDs ─────────────────────── */
  bookings.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  bookings.forEach((b, i) => {
    b.id = `BK-${new Date(b.createdAt).getFullYear()}-${String(i + 1).padStart(6, "0")}`;
  });
  for (const [m, victims] of maintenanceVictims) m.affectedBookingIds = victims.map((v) => v.id);

  /* Extra waitlists on other full sessions in the next two days. */
  {
    const sessions = new Map<string, Booking[]>();
    for (const b of bookings) {
      const s = new Date(b.start).getTime();
      if (s < A || s > A + 50 * HOUR || b.status === "CANCELLED") continue;
      const k = sKey(b.facilityId, s);
      const arr = sessions.get(k);
      if (arr) arr.push(b);
      else sessions.set(k, [b]);
    }
    for (const [, arr] of sessions) {
      const f = facById.get(arr[0].facilityId)!;
      if (arr.length < f.units || reservedEmpty.has(sKey(f.id, new Date(arr[0].start).getTime()))) continue;
      if (waitlist.some((w) => w.facilityId === f.id && w.start === arr[0].start)) continue;
      const n = randInt(rng, 0, f.mode === "exclusive" ? 3 : 2);
      for (let i = 0; i < n; i++) wl(f.id, new Date(arr[0].start), new Date(arr[0].end), pickWeighted().id, A - randInt(rng, 30, 1800) * MIN);
    }
  }

  /* ─────────────────────── Restrictions ─────────────────────── */
  const restrictions: Restriction[] = [];
  {
    const r3 = scen.r3;
    const rs = new Date(r3.noShow!.at).getTime();
    restrictions.push({ id: "RS-2041", userId: "u_rana", reason: "3 missed sessions in 60 days", source: "auto", start: iso(rs), end: iso(rs + 14 * 24 * HOUR), createdBy: "system" });
    // Any random student who ended up on 3+ strikes.
    const strikes = new Map<string, Booking[]>();
    for (const b of bookings) {
      if (specialIds.has(b.userId)) continue;
      if (b.status === "NO_SHOW" || b.cancellation?.penalty) {
        const arr = strikes.get(b.userId);
        if (arr) arr.push(b);
        else strikes.set(b.userId, [b]);
      }
    }
    let n = 2042;
    for (const [uid, arr] of strikes) {
      if (arr.length < 3) continue;
      arr.sort((a, b) => a.start.localeCompare(b.start));
      const third = new Date(arr[2].noShow?.at ?? arr[2].cancellation!.at).getTime();
      if (third > A) continue;
      restrictions.push({ id: `RS-${n++}`, userId: uid, reason: "3 missed sessions in 60 days", source: "auto", start: iso(third), end: iso(third + 14 * 24 * HOUR), createdBy: "system" });
    }
    // An older, lifted admin restriction for history.
    restrictions.push({ id: `RS-${n++}`, userId: pool[17].id, reason: "Damage to a billiards cue", source: "admin", start: iso(A - 12 * 24 * HOUR), end: iso(A + 18 * 24 * HOUR), createdBy: "u_admin_dina", lifted: { at: iso(A - 5 * 24 * HOUR), byUserId: "u_admin_dina", reason: "Student paid for the replacement cue" } });
  }

  /* ─────────────────────── Fair-use flags ─────────────────────── */
  const flags: FairnessFlag[] = [
    {
      id: "FF-118",
      type: "linked_back_to_back",
      status: "open",
      createdAt: iso(new Date(scen.am5.end).getTime() + 2 * HOUR),
      facilityId: "f_football",
      userIds: ["u_ahmed", "u_mohamed"],
      bookingIds: [scen.am4.id, scen.am5.id],
      summary: "Ahmed Hassan and Mohamed Tarek held back-to-back sessions on the Football Pitch. Check-in shows 5 of the same players on the pitch for both.",
      evidence: { sharedSessions: 3, lookbackDays: 30, occurrences: 1 },
    },
    {
      id: "FF-117",
      type: "repeat_late_cancel",
      status: "open",
      createdAt: iso(new Date(scen["h-2"].cancellation!.at).getTime() + 30 * MIN),
      facilityId: "f_padel",
      userIds: ["u_hana"],
      bookingIds: [scen["h-12"].id, scen["h-6"].id, scen["h-2"].id],
      summary: "Hana Mahmoud cancelled 3 prime-time padel sessions within 2 hours of the start in the last 14 days.",
      evidence: { sharedSessions: 0, lookbackDays: 14, occurrences: 3 },
    },
    {
      id: "FF-112",
      type: "linked_back_to_back",
      status: "dismissed",
      createdAt: iso(A - 11 * 24 * HOUR),
      facilityId: "f_volleyball",
      userIds: [squads[5][0], squads[5][1]],
      bookingIds: [],
      summary: "Two students held adjacent volleyball sessions. Check-in showed different players.",
      evidence: { sharedSessions: 3, lookbackDays: 30, occurrences: 1 },
      resolution: { at: iso(A - 10 * 24 * HOUR), byUserId: "u_admin_nour", action: "dismissed", note: "Different teams — inter-faculty league fixtures." },
    },
  ];

  /* ─────────────────────── Issues ─────────────────────── */
  const issues: FacilityIssue[] = [
    { id: "IS-412", facilityId: "f_airhockey", reportedBy: "u_staff_mona", category: "equipment", severity: "medium", description: "Blower fan weak on the left side — the puck slows down. Technician requested.", createdAt: iso(A - 19 * HOUR), status: "open" },
    { id: "IS-409", facilityId: "f_football", reportedBy: "u_staff_karim", category: "lighting", severity: "high", description: "North-side floodlight bank flickering after 20:00. Electrician requested; evening sessions may be closed at short notice.", createdAt: new Date(mtFoot.createdAt).toISOString(), status: "in_progress" },
    { id: "IS-414", facilityId: "f_pingpong", reportedBy: "u_staff_mona", category: "equipment", severity: "low", description: "Table 2 — net clamp loose on one side.", createdAt: iso(A - 3 * HOUR), status: "open" },
    { id: "IS-411", facilityId: "f_billiards", reportedBy: "u_staff_mona", category: "equipment", severity: "medium", description: "Three cues have worn tips. Replacements ordered.", createdAt: iso(A - 2 * 24 * HOUR), status: "open" },
    { id: "IS-405", facilityId: "f_padel", reportedBy: "u_staff_karim", category: "safety", severity: "low", description: "Court 2 glass door not latching properly.", createdAt: iso(A - 8 * 24 * HOUR), status: "resolved", resolvedAt: iso(A - 7 * 24 * HOUR), resolvedBy: "u_staff_karim" },
  ];

  /* ─────────────────────── Notifications ─────────────────────── */
  const notifications: AppNotification[] = [];
  const note = (userId: string, type: AppNotification["type"], title: string, body: string, at: number, read: boolean, extra: Partial<AppNotification> = {}) =>
    notifications.push({ id: `N-${String(9000 + notifications.length)}`, userId, type, title, body, createdAt: iso(at), readAt: read ? iso(at + 20 * MIN) : undefined, ...extra });
  const fmtS = (b: Booking) => `${format(new Date(b.start), "EEE d MMM")}, ${format(new Date(b.start), "HH:mm")}–${format(new Date(b.end), "HH:mm")}`;
  note(Y, "slot_available", "The Tennis Court opened up", `${format(new Date(offerEntry.start), "EEE d MMM, HH:mm")}–${format(new Date(offerEntry.end), "HH:mm")}. It’s held for you — claim it before the offer moves to the next student.`, new Date(offerEntry.offeredAt!).getTime(), false, { link: "/bookings?tab=waitlist", data: { waitlistId: offerEntry.id, facilityId: "f_tennis", expiresAt: offerEntry.offerExpiresAt } });
  note(Y, "booking_confirmed", "Ping-Pong Tables confirmed", `${fmtS(scen.yPing)} · Activity Center. Your QR ticket is in My Bookings.`, new Date(scen.yPing.createdAt).getTime(), false, { link: `/bookings/${scen.yPing.id}`, data: { bookingId: scen.yPing.id } });
  note(Y, "booking_confirmed", "Football Pitch confirmed", `${fmtS(scen.yFootball)} · 7 players. Everyone on your list has been notified.`, new Date(scen.yFootball.createdAt).getTime(), true, { link: `/bookings/${scen.yFootball.id}`, data: { bookingId: scen.yFootball.id } });
  note(Y, "waitlist_joined", "You’re #3 on the Padel Courts waitlist", "We’ll notify you as soon as a court opens up.", A - 19 * HOUR - 55 * MIN, true, { link: "/bookings?tab=waitlist" });
  note(Y, "participant_added", "Omar Khaled added you to a booking", `Football Pitch · ${fmtS(scen.y3)}`, new Date(scen.y3.createdAt).getTime(), true, { link: `/bookings/${scen.y3.id}`, data: { bookingId: scen.y3.id } });
  note(Y, "booking_cancelled", "Tennis Court booking cancelled", `${fmtS(scen.y6)} — cancelled in time, no strike recorded.`, new Date(scen.y6.cancellation!.at).getTime(), true, { data: { bookingId: scen.y6.id } });
  note(Y, "noshow_warning", "Missed session: Ping-Pong Tables", `You didn’t check in for ${fmtS(scen.y5)}. This is your first missed session — at 3, booking is paused for 14 days. Strikes expire after 60 days.`, new Date(scen.y5.noShow!.at).getTime(), true, { link: "/profile" });
  // Staff & admin
  note("u_staff_mona", "maintenance", "Billiards table closure scheduled", `${format(new Date(mtBilliards.start), "EEE d MMM")} 12:00–16:00 — table re-felting. 3 bookings were cancelled and students notified.`, new Date(mtBilliards.createdAt).getTime(), true);
  note("u_staff_karim", "booking_reminder", "Evening peak starts at 17:00", "The football pitch and both padel courts are fully booked tonight.", A - 2 * HOUR, false);
  note("u_admin_nour", "fairness_notice", "New fair-use flag on the Football Pitch", "Ahmed Hassan and Mohamed Tarek held back-to-back sessions. Review in Fair use.", new Date(flags[0].createdAt).getTime(), false, { link: "/admin/fairness" });
  note("u_admin_nour", "maintenance", "Issue reported: Air Hockey Table", "Blower fan weak on the left side. Reported by Mona Saleh.", A - 19 * HOUR, true, { link: "/admin/facilities" });
  for (const id of ["u_super_tamer", "u_admin_dina"]) note(id, "fairness_notice", "New fair-use flag on the Football Pitch", "Ahmed Hassan and Mohamed Tarek held back-to-back sessions.", new Date(flags[0].createdAt).getTime(), false, { link: "/admin/fairness" });

  /* ─────────────────────── Favorites ─────────────────────── */
  const favorites: Favorite[] = ["f_football", "f_padel", "f_pingpong"].map((fid, i) => ({ id: `${Y}:${fid}`, userId: Y, facilityId: fid, createdAt: iso(A - (40 - i * 7) * 24 * HOUR) }));

  /* ─────────────────────── Audit log ─────────────────────── */
  const audit: AuditLog[] = [];
  const ipFor = (role: string, seed: number) => (role === "student" ? `41.${196 + (seed % 40)}.${(seed * 7) % 255}.${(seed * 13) % 255}` : `10.12.${(seed * 3) % 40}.${(seed * 11) % 255}`);
  const log = (at: number, actorId: string, action: string, entityType: AuditLog["entityType"], entityId: string, entityLabel: string, summary: string) => {
    const actor = actorId === "system" ? null : userById.get(actorId);
    audit.push({ id: "", at: iso(at), actorId, actorName: actor?.name ?? "System", actorRole: actor ? actor.role : "system", action, entityType, entityId, entityLabel, summary, ip: actor ? ipFor(actor.role, audit.length + 17) : "—" });
  };
  const recent = bookings.filter((b) => new Date(b.createdAt).getTime() > A - 3 * 24 * HOUR);
  for (const b of recent.filter((_, i) => i % Math.max(1, Math.floor(recent.length / 45)) === 0)) {
    const f = facById.get(b.facilityId)!;
    log(new Date(b.createdAt).getTime(), b.userId, "booking.create", "booking", b.id, b.id, `Booked ${f.name} for ${fmtS(b)}`);
  }
  const checkins = bookings.filter((b) => b.checkIn && new Date(b.checkIn.at).getTime() > A - 2 * 24 * HOUR && new Date(b.checkIn.at).getTime() <= A);
  for (const b of checkins.filter((_, i) => i % Math.max(1, Math.floor(checkins.length / 50)) === 0)) {
    const f = facById.get(b.facilityId)!;
    log(new Date(b.checkIn!.at).getTime(), b.checkIn!.byUserId, "booking.check_in", "booking", b.id, b.id, `Checked in ${userById.get(b.userId)?.name} at ${f.name} (${b.checkIn!.method === "qr" ? "QR scan" : "manual"})`);
  }
  for (const b of bookings.filter((x) => x.status === "NO_SHOW" && new Date(x.noShow!.at).getTime() > A - 6 * 24 * HOUR && new Date(x.noShow!.at).getTime() <= A)) {
    log(new Date(b.noShow!.at).getTime(), "system", "booking.no_show", "booking", b.id, b.id, `Marked ${userById.get(b.userId)?.name} as no-show at ${facById.get(b.facilityId)!.name} (grace period ended)`);
  }
  const cancels = bookings.filter((x) => x.cancellation && new Date(x.cancellation.at).getTime() > A - 4 * 24 * HOUR);
  for (const b of cancels.filter((_, i) => i % Math.max(1, Math.floor(cancels.length / 20)) === 0)) {
    log(new Date(b.cancellation!.at).getTime(), b.cancellation!.byUserId, "booking.cancel", "booking", b.id, b.id, `Cancelled ${facById.get(b.facilityId)!.name}, ${fmtS(b)}${b.cancellation!.late ? " (late)" : ""}`);
  }
  log(new Date(mtBilliards.createdAt).getTime(), "u_admin_nour", "maintenance.create", "maintenance", mtBilliards.id, "Billiards Table", `Scheduled maintenance ${format(new Date(mtBilliards.start), "d MMM HH:mm")}–${format(new Date(mtBilliards.end), "HH:mm")}: table re-felting. 3 bookings cancelled, students notified.`);
  log(new Date(mtFoot.createdAt).getTime(), "u_staff_karim", "facility.close_temporarily", "maintenance", mtFoot.id, "Football Pitch", "Closed the pitch 20:00–22:00 — floodlight failure. 2 bookings cancelled without penalty.");
  log(new Date(issues[0].createdAt).getTime(), "u_staff_mona", "issue.report", "issue", "IS-412", "Air Hockey Table", "Reported: blower fan weak (medium)");
  log(new Date(issues[2].createdAt).getTime(), "u_staff_mona", "issue.report", "issue", "IS-414", "Ping-Pong Tables", "Reported: table 2 net clamp loose (low)");
  log(new Date(restrictions[0].start).getTime(), "system", "restriction.create", "restriction", restrictions[0].id, "Rana Essam", "Booking paused for 14 days — reached 3 missed sessions");
  log(new Date(flags[0].createdAt).getTime(), "system", "flag.create", "flag", flags[0].id, "Football Pitch", "Fair-use scan flagged back-to-back sessions by a linked group");
  log(new Date(flags[1].createdAt).getTime(), "system", "flag.create", "flag", flags[1].id, "Padel Courts", "Fair-use scan flagged repeated late cancellations");
  log(A - 23 * HOUR, "u_admin_nour", "policy.update", "policy", "cat_team", "Team Sports", "Linked-group detection: off → block after 3 shared sessions in 30 days");
  log(A - 23 * HOUR + 3 * MIN, "u_admin_nour", "policy.update", "policy", "cat_team", "Team Sports", "Rest period between stays: 60 → 120 min");
  log(A - 9 * 24 * HOUR, "u_admin_dina", "policy.update", "policy", "cat_racket", "Racket Sports", "Waitlist claim window: 20 → 30 min");
  log(A - 6 * 24 * HOUR, "u_super_tamer", "settings.update", "settings", "security", "Security", "QR code rotation: 60 → 30 seconds");
  log(A - 6 * 24 * HOUR + 4 * MIN, "u_super_tamer", "role.update", "role", "staff", "Facility staff", "Granted “facility.close_temporarily” to Facility staff");
  for (const [i, id] of ["u_admin_nour", "u_admin_nour", "u_super_tamer", "u_staff_karim", "u_admin_dina"].entries()) {
    const u = userById.get(id)!;
    log(A - (i * 9 + 2) * HOUR, id, "session.sign_in", "session", id, u.name, "Signed in");
  }
  audit.sort((a, b) => b.at.localeCompare(a.at));
  audit.forEach((a, i) => (a.id = `AU-${String(58000 + audit.length - i)}`));

  /* ─────────────────────── Analytics warehouse ─────────────────────── */
  const dailyStats: DailyStat[] = [];
  for (let d = -90; d < -14; d++) {
    const day = addDays(D0, d);
    for (const f of FACILITIES) {
      const cat = catById.get(f.categoryId)!;
      const sessions = sessionTimes(f, day);
      const byHour = new Array(24).fill(0);
      let booked = 0;
      for (const s of sessions) {
        const p = demand(f, cat, s.start, 0);
        const n = f.mode === "exclusive" ? Array.from({ length: f.units }).filter(() => rng() < p).length : Math.round(f.units * Math.max(0, Math.min(1, p + (rng() - 0.5) * 0.25)));
        booked += n;
        byHour[s.start.getHours()] += n;
      }
      dailyStats.push({
        date: format(day, "yyyy-MM-dd"),
        facilityId: f.id,
        capacity: sessions.length * f.units,
        booked,
        attended: Math.round(booked * (0.84 + rng() * 0.06)),
        noShows: Math.round(booked * (0.035 + rng() * 0.03)),
        cancellations: Math.round(booked * (0.06 + rng() * 0.04)),
        waitlistJoins: Math.round(booked * (POPULARITY[f.id] > 0.9 ? 0.12 : 0.02) * rng()),
        byHour,
      });
    }
  }

  return {
    meta: { anchor: anchorISO, bookingSeq: bookings.length, seq: 100, demo: true },
    settings: { ...SETTINGS },
    globalPolicy: structuredClone(GLOBAL_POLICY),
    roles: structuredClone(ROLES),
    users,
    categories: structuredClone(CATEGORIES),
    facilities: structuredClone(FACILITIES),
    bookings,
    waitlist,
    maintenance,
    issues,
    restrictions,
    flags,
    notifications,
    audit,
    favorites,
    sessions: [],
    devices: [],
    deviceRequests: [],
    credentials: [],
    dailyStats,
  };
}

