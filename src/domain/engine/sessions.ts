import { addDays, addMinutes, startOfDay } from "date-fns";
import { atTime, overlaps } from "@/lib/time";
import type { Booking, Facility, ID, MaintenancePeriod } from "../types";
import { CAPACITY_STATUSES, EngineIndex, sessionKey } from "./snapshot";

export type SessionState =
  | "available" // bookable, plenty of room
  | "limited" // bookable, almost full
  | "full" // no room left
  | "maintenance" // blocked by a maintenance period
  | "closed" // facility inactive, or booking has closed (lead time)
  | "past" // already started
  | "not_open"; // beyond the advance-booking window

export interface SessionInfo {
  key: string;
  facilityId: ID;
  start: string;
  end: string;
  capacity: number;
  taken: number;
  /** Spots held for students who were offered a waitlist spot. */
  held: number;
  remaining: number;
  waitlistCount: number;
  state: SessionState;
  maintenance?: MaintenancePeriod;
  /** When this session opens for booking (state = not_open). */
  opensAt?: string;
  /** Exclusive facilities: which space the next booking would get. */
  freeUnitIndex: number;
}

/** Session start/end times for a facility on a day. Turnover is built in. */
export function sessionTimes(facility: Facility, day: Date): { start: Date; end: Date }[] {
  const hours = facility.schedule[day.getDay()];
  if (!hours) return [];
  const out: { start: Date; end: Date }[] = [];
  let start = atTime(day, hours.open);
  const close = atTime(day, hours.close);
  const step = facility.sessionMinutes + facility.turnoverMinutes;
  if (step <= 0) return out;
  while (addMinutes(start, facility.sessionMinutes) <= close) {
    out.push({ start, end: addMinutes(start, facility.sessionMinutes) });
    start = addMinutes(start, step);
  }
  return out;
}

export function capacityBookings(ix: EngineIndex, facilityId: ID, start: number, end: number, ignoreBookingId?: ID): Booking[] {
  return ix.bookingsForFacility(facilityId).filter((b) => b.id !== ignoreBookingId && CAPACITY_STATUSES.has(b.status) && overlaps(start, end, new Date(b.start).getTime(), new Date(b.end).getTime()));
}

export function describeSession(
  ix: EngineIndex,
  facility: Facility,
  startDate: Date,
  endDate: Date,
  opts: { excludeHoldForUserId?: ID; ignoreBookingId?: ID } = {},
): SessionInfo {
  const now = ix.now;
  const policy = ix.policyFor(facility);
  const start = startDate.getTime();
  const end = endDate.getTime();
  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();

  const bookings = capacityBookings(ix, facility.id, start, end, opts.ignoreBookingId);
  const usedUnits = new Set(bookings.map((b) => b.unitIndex));
  let freeUnitIndex = 0;
  while (usedUnits.has(freeUnitIndex)) freeUnitIndex++;

  const queue = ix.waitlistFor(facility.id, startISO);
  const held = queue.filter((w) => w.status === "offered" && w.offerExpiresAt && new Date(w.offerExpiresAt) > now && w.userId !== opts.excludeHoldForUserId).length;
  const waitlistCount = queue.filter((w) => w.status === "waiting" || w.status === "offered").length;

  const capacity = facility.units;
  const taken = facility.mode === "exclusive" ? usedUnits.size : bookings.length;
  const remaining = Math.max(0, capacity - taken - held);

  const maintenance = ix.maintenanceFor(facility.id).find((m) => overlaps(start, end, new Date(m.start).getTime(), new Date(m.end).getTime()));

  const lastBookableDay = addDays(startOfDay(now), policy.window.advanceDays);
  const sessionDay = startOfDay(startDate);

  let state: SessionState;
  let opensAt: string | undefined;
  if (start <= now.getTime()) state = "past";
  else if (facility.status !== "active") state = "closed";
  else if (maintenance) state = "maintenance";
  else if (sessionDay > lastBookableDay) {
    state = "not_open";
    opensAt = addDays(sessionDay, -policy.window.advanceDays).toISOString();
  } else if (start - now.getTime() < policy.window.minLeadMinutes * 60000) state = "closed";
  else if (remaining <= 0) state = "full";
  else if (capacity > 1 && remaining <= Math.max(1, Math.ceil(capacity * 0.2))) state = "limited";
  else state = "available";

  return {
    key: sessionKey(facility.id, startISO),
    facilityId: facility.id,
    start: startISO,
    end: endISO,
    capacity,
    taken,
    held,
    remaining,
    waitlistCount,
    state,
    maintenance,
    opensAt,
    freeUnitIndex,
  };
}

export function daySessions(ix: EngineIndex, facility: Facility, day: Date, opts: { excludeHoldForUserId?: ID } = {}): SessionInfo[] {
  return sessionTimes(facility, day).map(({ start, end }) => describeSession(ix, facility, start, end, opts));
}

/** Find the session a start time belongs to (validates that it is a real session). */
export function findSession(facility: Facility, startISO: string): { start: Date; end: Date } | undefined {
  const start = new Date(startISO);
  return sessionTimes(facility, start).find((s) => s.start.getTime() === start.getTime());
}

export interface DaySummary {
  day: Date;
  open: boolean;
  total: number;
  bookable: number;
  state: "open" | "few" | "full" | "closed" | "not_open" | "past";
}

export function summarizeDay(ix: EngineIndex, facility: Facility, day: Date): DaySummary {
  const sessions = daySessions(ix, facility, day);
  const future = sessions.filter((s) => s.state !== "past");
  const bookable = future.filter((s) => s.state === "available" || s.state === "limited").length;
  let state: DaySummary["state"];
  if (sessions.length === 0 || facility.status !== "active") state = "closed";
  else if (future.length === 0) state = "past";
  else if (future.every((s) => s.state === "not_open")) state = "not_open";
  else if (bookable === 0) state = "full";
  else if (bookable <= 2) state = "few";
  else state = "open";
  return { day, open: sessions.length > 0, total: sessions.length, bookable, state };
}

/** Next bookable session from now, looking ahead a few days. */
export function nextAvailable(ix: EngineIndex, facility: Facility, lookaheadDays = 7): SessionInfo | undefined {
  const today = startOfDay(ix.now);
  for (let i = 0; i <= lookaheadDays; i++) {
    const s = daySessions(ix, facility, addDays(today, i)).find((x) => x.state === "available" || x.state === "limited");
    if (s) return s;
  }
  return undefined;
}

/** What is happening at a facility right now — for staff and "open now" views. */
export function currentSession(ix: EngineIndex, facility: Facility): SessionInfo | undefined {
  const now = ix.now.getTime();
  const sessions = sessionTimes(facility, ix.now);
  const cur = sessions.find((s) => s.start.getTime() <= now && s.end.getTime() > now);
  return cur ? describeSession(ix, facility, cur.start, cur.end) : undefined;
}
