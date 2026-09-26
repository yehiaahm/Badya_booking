import { describe, expect, it } from "vitest";
import { addDays, startOfDay } from "date-fns";
import { createSeed } from "../../../server/api/seed/generate";
import type { DbState } from "../../../server/api/state";
import { daySessions, EngineIndex, evaluateBooking, computeStanding, slotStatus, sessionTimes } from "./index";
import type { Booking } from "../types";

// Anchor: Thursday 24 September 2026, 14:20 local time.
const ANCHOR = new Date(2026, 8, 24, 14, 20).toISOString();
const db: DbState = createSeed(ANCHOR);

function index(state: DbState = db, now = new Date(ANCHOR)) {
  return new EngineIndex({
    now,
    globalPolicy: state.globalPolicy,
    weekStartsOn: state.settings.weekStartsOn,
    facilities: state.facilities,
    categories: state.categories,
    bookings: state.bookings,
    waitlist: state.waitlist,
    maintenance: state.maintenance,
    restrictions: state.restrictions,
    users: state.users,
  });
}

const at = (dayOffset: number, h: number, m = 0) => {
  const d = addDays(startOfDay(new Date(ANCHOR)), dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const SQUAD_D2 = ["u_youssef", "u_seif", "u_ziad", "u_adham", "u_marwan"];

describe("seed", () => {
  it("generates a realistic, rule-abiding dataset", () => {
    expect(db.users.filter((u) => u.role === "student").length).toBeGreaterThan(400);
    expect(db.bookings.length).toBeGreaterThan(500); // 7 facilities, ~3 weeks of history and upcoming sessions
    const ids = new Set(db.bookings.map((b) => b.id));
    expect(ids.size).toBe(db.bookings.length);
  });

  it("never double-books a space", () => {
    const seen = new Map<string, Booking[]>();
    for (const b of db.bookings) {
      if (b.status === "CANCELLED" || b.status === "EXPIRED") continue;
      const k = `${b.facilityId}|${b.start}`;
      seen.set(k, [...(seen.get(k) ?? []), b]);
    }
    for (const [k, arr] of seen) {
      const f = db.facilities.find((x) => x.id === k.split("|")[0])!;
      expect(arr.length, k).toBeLessThanOrEqual(f.units);
      if (f.mode === "exclusive") expect(new Set(arr.map((b) => b.unitIndex)).size, k).toBe(arr.length);
    }
  });
});

describe("booking engine", () => {
  const ix = index();

  it("computes sessions with turnover built in", () => {
    const f = { ...db.facilities.find((x) => x.id === "f_football")!, turnoverMinutes: 15 };
    const times = sessionTimes(f, new Date(ANCHOR)).map((s) => s.start.toTimeString().slice(0, 5));
    expect(times).toContain("08:00");
    expect(times).toContain("09:15"); // 60 min + 15 min turnover
    expect(times).not.toContain("09:00");
  });

  it("blocks the same student from booking back-to-back sessions", () => {
    const ev = evaluateBooking(ix, { facilityId: "f_football", start: at(1, 19), userId: "u_yehia", participantIds: SQUAD_D2 });
    expect(ev.ok).toBe(false);
    expect(ev.blocking.map((b) => b.code)).toContain("consecutive");
    const msg = ev.blocking.find((b) => b.code === "consecutive")!.message;
    expect(msg).toMatch(/immediately before/);
  });

  it("blocks a linked group from extending through a friend's account", () => {
    const ev = evaluateBooking(ix, { facilityId: "f_football", start: at(2, 20), userId: "u_yehia", participantIds: SQUAD_D2 });
    expect(ev.blocking.map((b) => b.code)).toEqual(["linked_group"]);
    expect(ev.linkedGroup?.otherId).toBe("u_omar");
  });

  it("applies limits to listed participants", () => {
    // Omar already plays on day +2, so he can't be added to another Team Sports booking that day.
    const ev = evaluateBooking(ix, { facilityId: "f_football", start: at(2, 9), userId: "u_yehia", participantIds: [...SQUAD_D2, "u_omar"] });
    expect(ev.blocking.some((b) => b.personId === "u_omar")).toBe(true);
  });

  const freeSlot = () => {
    const f = db.facilities.find((x) => x.id === "f_football")!;
    return daySessions(ix, f, addDays(new Date(ANCHOR), 2)).find((s) => s.state === "available" && evaluateBooking(ix, { facilityId: f.id, start: s.start, userId: "u_yehia", participantIds: SQUAD_D2 }).ok)!;
  };

  it("allows a clean booking", () => {
    const slot = freeSlot();
    expect(slot).toBeDefined();
    const ev = evaluateBooking(ix, { facilityId: "f_football", start: slot.start, userId: "u_yehia", participantIds: SQUAD_D2 });
    expect(ev.blocking).toEqual([]);
    expect(ev.ok).toBe(true);
  });

  it("requires the minimum number of participants", () => {
    const ev = evaluateBooking(ix, { facilityId: "f_football", start: freeSlot().start, userId: "u_yehia", participantIds: ["u_seif"] });
    expect(ev.blocking.map((b) => b.code)).toEqual(["participants_count"]);
    expect(slotStatus(ev)).toBe("available");
  });

  it("enforces the category daily limit across facilities (no court-hopping)", () => {
    // Yehia plays football on day +1, so the volleyball court is off-limits that day too.
    const f = db.facilities.find((x) => x.id === "f_volleyball")!;
    const s = sessionTimes(f, addDays(new Date(ANCHOR), 1)).find((x) => x.start.getHours() === 10)!;
    const ev = evaluateBooking(ix, { facilityId: "f_volleyball", start: s.start.toISOString(), userId: "u_yehia", participantIds: SQUAD_D2 });
    expect(ev.blocking.map((b) => b.code)).toContain("daily_limit");
  });

  it("keeps the Activity Center closed on Fridays", () => {
    const f = db.facilities.find((x) => x.id === "f_pingpong")!;
    expect(new Date(at(1, 12)).getDay()).toBe(5);
    expect(sessionTimes(f, addDays(new Date(ANCHOR), 1))).toEqual([]);
    expect(sessionTimes(f, addDays(new Date(ANCHOR), 2)).length).toBeGreaterThan(0);
  });

  it("blocks restricted students with a readable reason", () => {
    const f = db.facilities.find((x) => x.id === "f_pingpong")!;
    const s = daySessions(ix, f, addDays(new Date(ANCHOR), 2))[3];
    const ev = evaluateBooking(ix, { facilityId: "f_pingpong", start: s.start, userId: "u_rana" });
    expect(ev.blocking[0].code).toBe("restricted");
    expect(ev.blocking[0].message).toMatch(/paused until/);
  });

  it("blocks students outside a facility's allowed faculties", () => {
    const facilities = db.facilities.map((f) => (f.id === "f_billiards" ? { ...f, access: { ...f.access, faculties: ["Engineering"] } } : f));
    const restricted = index({ ...db, facilities });
    const f = facilities.find((x) => x.id === "f_billiards")!;
    const s = daySessions(restricted, f, addDays(new Date(ANCHOR), 2))[0];
    const ev = evaluateBooking(restricted, { facilityId: "f_billiards", start: s.start, userId: "u_yehia" });
    expect(ev.blocking.map((b) => b.code)).toContain("eligibility");
  });

  it("blocks sessions during maintenance", () => {
    const m = db.maintenance.find((x) => x.facilityId === "f_billiards" && new Date(x.start) > new Date(ANCHOR))!;
    const f = db.facilities.find((x) => x.id === "f_billiards")!;
    const s = sessionTimes(f, new Date(m.start)).find((x) => x.start >= new Date(m.start))!;
    const ev = evaluateBooking(ix, { facilityId: "f_billiards", start: s.start.toISOString(), userId: "u_yehia" });
    expect(ev.blocking.map((b) => b.code)).toContain("maintenance");
  });

  it("holds an offered waitlist spot for the offered student only", () => {
    const offer = db.waitlist.find((w) => w.userId === "u_yehia" && w.status === "offered")!;
    expect(offer.facilityId).toBe("f_tennis");
    const mine = evaluateBooking(ix, { facilityId: offer.facilityId, start: offer.start, userId: "u_yehia", participantIds: ["u_salma"] });
    expect(mine.blocking).toEqual([]);
    const other = evaluateBooking(ix, { facilityId: offer.facilityId, start: offer.start, userId: "u_mariam", participantIds: ["u_laila"] });
    expect(other.blocking.map((b) => b.code)).toContain("full");
  });

  it("reports waitlist positions", () => {
    const entry = db.waitlist.find((w) => w.userId === "u_yehia" && w.status === "waiting")!;
    expect(entry.facilityId).toBe("f_padel");
    const ev = evaluateBooking(ix, { facilityId: entry.facilityId, start: entry.start, userId: "u_yehia" });
    expect(ev.waitlist.position).toBe(3);
  });

  it("computes no-show standing", () => {
    expect(computeStanding(ix, "u_yehia").level).toBe("warning");
    expect(computeStanding(ix, "u_nadine").level).toBe("final_warning");
    expect(computeStanding(ix, "u_rana").level).toBe("restricted");
  });
});
