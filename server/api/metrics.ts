import { addDays, format, startOfDay } from "date-fns";
import { sessionTimes } from "@/domain/engine/sessions";
import type { Booking, DailyStat, Facility } from "@/domain/types";
import { db } from "./db";

/**
 * Daily facility statistics. Recent days are computed live from booking
 * records; older days come from the pre-aggregated warehouse (DailyStat).
 */

export interface DayStat {
  capacity: number;
  booked: number;
  attended: number;
  noShows: number;
  cancellations: number;
  waitlistJoins: number;
  byHour: number[];
}

let cacheRev = -1;
let byFacilityDay = new Map<string, Booking[]>();
let warehouse = new Map<string, DailyStat>();
let waitlistByDay = new Map<string, number>();

function ensure() {
  if (cacheRev === db.rev) return;
  cacheRev = db.rev;
  byFacilityDay = new Map();
  for (const b of db.state.bookings) {
    const k = `${b.facilityId}|${format(new Date(b.start), "yyyy-MM-dd")}`;
    const arr = byFacilityDay.get(k);
    if (arr) arr.push(b);
    else byFacilityDay.set(k, [b]);
  }
  warehouse = new Map(db.state.dailyStats.map((d) => [`${d.facilityId}|${d.date}`, d]));
  waitlistByDay = new Map();
  for (const w of db.state.waitlist) {
    const k = `${w.facilityId}|${format(new Date(w.start), "yyyy-MM-dd")}`;
    waitlistByDay.set(k, (waitlistByDay.get(k) ?? 0) + 1);
  }
}

export const liveFrom = () => addDays(startOfDay(db.anchorDate), -14);

export function dayStat(f: Facility, day: Date): DayStat {
  ensure();
  const key = format(day, "yyyy-MM-dd");
  if (day < liveFrom()) {
    const w = warehouse.get(`${f.id}|${key}`);
    if (w) return w;
    return { capacity: 0, booked: 0, attended: 0, noShows: 0, cancellations: 0, waitlistJoins: 0, byHour: new Array(24).fill(0) };
  }
  const sessions = sessionTimes(f, day);
  const list = byFacilityDay.get(`${f.id}|${key}`) ?? [];
  const byHour = new Array(24).fill(0);
  let booked = 0;
  let attended = 0;
  let noShows = 0;
  let cancellations = 0;
  for (const b of list) {
    if (b.status === "CANCELLED" || b.status === "EXPIRED") {
      if (b.status === "CANCELLED") cancellations++;
      continue;
    }
    booked++;
    byHour[new Date(b.start).getHours()]++;
    if (b.status === "COMPLETED" || b.status === "CHECKED_IN") attended++;
    if (b.status === "NO_SHOW") noShows++;
  }
  return { capacity: f.status === "active" ? sessions.length * f.units : 0, booked, attended, noShows, cancellations, waitlistJoins: waitlistByDay.get(`${f.id}|${key}`) ?? 0, byHour };
}

export function utilization(f: Facility, from: Date, days: number): number {
  let cap = 0;
  let booked = 0;
  for (let i = 0; i < days; i++) {
    const s = dayStat(f, addDays(from, i));
    cap += s.capacity;
    booked += s.booked;
  }
  return cap > 0 ? Math.min(1, booked / cap) : 0;
}

/** Share of capacity booked by hour of day over the last four weeks. */
export function popularTimes(f: Facility, today: Date): number[] {
  const booked = new Array(24).fill(0);
  const cap = new Array(24).fill(0);
  for (let i = 1; i <= 28; i++) {
    const day = addDays(startOfDay(today), -i);
    const s = dayStat(f, day);
    for (const st of sessionTimes(f, day)) cap[st.start.getHours()] += f.units;
    s.byHour.forEach((v, h) => (booked[h] += v));
  }
  return booked.map((v, h) => (cap[h] ? Math.min(1, v / cap[h]) : 0));
}
