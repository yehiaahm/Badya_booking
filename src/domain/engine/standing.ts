import { addDays } from "date-fns";
import type { Booking, BookingPolicy, ID, NoShowStep, Restriction } from "../types";
import { EngineIndex } from "./snapshot";

export interface Strike {
  bookingId: ID;
  facilityId: ID;
  type: "no_show" | "late_cancel";
  at: string;
  expiresAt: string;
}

export type StandingLevel = "good" | "warning" | "final_warning" | "restricted";

export interface Standing {
  strikes: Strike[];
  /** Strikes that have expired — shown as history only. */
  expired: Strike[];
  level: StandingLevel;
  restriction?: Restriction;
  /** The next ladder step the student would reach. */
  next?: NoShowStep;
  ladder: NoShowStep[];
}

export function strikesFor(bookings: Booking[], userId: ID, policy: BookingPolicy, now: Date): { active: Strike[]; expired: Strike[] } {
  const active: Strike[] = [];
  const expired: Strike[] = [];
  for (const b of bookings) {
    if (b.userId !== userId) continue;
    let s: Omit<Strike, "expiresAt"> | undefined;
    if (b.status === "NO_SHOW" && b.noShow && !b.noShow.waived) s = { bookingId: b.id, facilityId: b.facilityId, type: "no_show", at: b.start };
    else if (b.status === "CANCELLED" && b.cancellation?.penalty) s = { bookingId: b.id, facilityId: b.facilityId, type: "late_cancel", at: b.cancellation.at };
    if (!s) continue;
    const expiresAt = addDays(new Date(s.at), policy.noShow.strikeExpiryDays);
    (expiresAt > now ? active : expired).push({ ...s, expiresAt: expiresAt.toISOString() });
  }
  active.sort((a, b) => b.at.localeCompare(a.at));
  expired.sort((a, b) => b.at.localeCompare(a.at));
  return { active, expired };
}

export function computeStanding(ix: EngineIndex, userId: ID): Standing {
  const policy = ix.s.globalPolicy;
  const { active, expired } = strikesFor(ix.involvements(userId), userId, policy, ix.now);
  const ladder = [...policy.noShow.ladder].sort((a, b) => a.strikes - b.strikes);
  const restriction = ix.activeRestriction(userId);
  let level: StandingLevel = "good";
  for (const step of ladder) {
    if (active.length >= step.strikes) level = step.action === "restrict" ? "restricted" : step.action;
  }
  // A restriction only applies while it is active; strikes alone at the top
  // of the ladder without an active restriction read as a final warning.
  if (level === "restricted" && !restriction) level = "final_warning";
  if (restriction) level = "restricted";
  const next = ladder.find((s) => s.strikes > active.length);
  return { strikes: active, expired, level, restriction, next, ladder };
}

/** Which ladder step (if any) is reached exactly by this strike count. */
export function ladderStepFor(policy: BookingPolicy, strikes: number): NoShowStep | undefined {
  return [...policy.noShow.ladder].sort((a, b) => b.strikes - a.strikes).find((s) => strikes >= s.strikes);
}
