import type { BookingPolicy, Facility, FacilityCategory, PolicyOverride } from "./types";
import { N, arCount, L, tx } from "@/i18n/lang";

/**
 * Policy resolution: global → category → facility.
 * Nothing about limits or fairness is hard-coded in the engine — every rule
 * reads its numbers from the resolved BookingPolicy.
 */

export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined || override === null) return base;
  if (Array.isArray(base) || typeof base !== "object" || base === null) {
    return override as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] = cur && typeof cur === "object" && !Array.isArray(cur) && v && typeof v === "object" && !Array.isArray(v) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

export function resolvePolicy(global: BookingPolicy, category?: FacilityCategory | null, facility?: Facility | null): BookingPolicy {
  let p = global;
  if (category) p = deepMerge(p, category.policy);
  if (facility) p = deepMerge(p, facility.policy);
  // Campus-wide guardrails and the no-show ladder are global-only.
  return { ...p, campus: global.campus, noShow: global.noShow };
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function setPath<T extends object>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const clone: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  let cur = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    cur[keys[i]] = next && typeof next === "object" ? { ...(next as Record<string, unknown>) } : {};
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  if (value === undefined) delete cur[keys[keys.length - 1]];
  else cur[keys[keys.length - 1]] = value;
  return clone as T;
}

/** Remove a key from an override and prune empty parents. */
export function unsetPath<T extends object>(obj: T, path: string): T {
  const next = setPath(obj, path, undefined);
  const prune = (o: Record<string, unknown>): Record<string, unknown> => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const pr = prune(v as Record<string, unknown>);
        if (Object.keys(pr).length === 0) delete o[k];
        else o[k] = pr;
      }
    }
    return o;
  };
  return prune(next as Record<string, unknown>) as T;
}

export function countOverrides(o: PolicyOverride | undefined): number {
  if (!o) return 0;
  let n = 0;
  const walk = (x: unknown, path: string) => {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      for (const [k, v] of Object.entries(x)) walk(v, path ? `${path}.${k}` : k);
    } else if (x !== undefined) n++;
  };
  walk(o, "");
  return n;
}

/* ───────────────────────── Schema for the policy editor ───────────────────────── */

export type PolicyLevel = "global" | "category" | "facility";

export interface PolicyField {
  path: string;
  label: string;
  help: string;
  type: "number" | "boolean" | "select";
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  levels: PolicyLevel[];
  /** Only shown when this boolean path is true. */
  dependsOn?: string;
}

export interface PolicyGroup {
  id: string;
  title: string;
  description: string;
  icon: string;
  fields: PolicyField[];
}

const ALL: PolicyLevel[] = ["global", "category", "facility"];

export const POLICY_SCHEMA: PolicyGroup[] = [
  {
    id: "fairness",
    title: tx("Fair usage"),
    description: tx("Stops one person or one group from holding a facility for hours at a time."),
    icon: "scale",
    fields: [
      { path: "fairness.scope", label: tx("Rules apply across"), help: tx("“Whole category” stops students hopping from Pitch A to Pitch B to keep playing."), type: "select", options: [{ value: "facility", label: tx("This facility only") }, { value: "category", label: tx("Whole category") }], levels: ALL },
      { path: "fairness.maxConsecutive", label: tx("Max back-to-back sessions"), help: tx("How many sessions in a row one person may hold. 1 = no consecutive bookings."), type: "number", min: 1, max: 6, unit: "sessions", levels: ALL },
      { path: "fairness.restMinutes", label: tx("Rest period between stays"), help: tx("Minimum time between two separate bookings by the same person."), type: "number", min: 0, max: 720, step: 15, unit: "min", levels: ALL },
      { path: "fairness.applyToParticipants", label: tx("Apply rules to every listed participant"), help: tx("Teammates listed on a booking are held to the same limits as the booker."), type: "boolean", levels: ALL },
      { path: "fairness.linkedGroups.enabled", label: tx("Detect linked groups"), help: tx("Treat students who often play together as one group, even when they use different accounts."), type: "boolean", levels: ALL },
      { path: "fairness.linkedGroups.minSharedSessions", label: tx("Linked after sharing"), help: tx("Two students are linked once they have been on this many bookings together."), type: "number", min: 2, max: 20, unit: "sessions", levels: ALL, dependsOn: "fairness.linkedGroups.enabled" },
      { path: "fairness.linkedGroups.lookbackDays", label: tx("Look back"), help: tx("Only bookings within this window count towards a link."), type: "number", min: 7, max: 120, unit: "days", levels: ALL, dependsOn: "fairness.linkedGroups.enabled" },
      { path: "fairness.linkedGroups.action", label: tx("When a linked group books back-to-back"), help: tx("Block the booking, or allow it and send it to the fair-use review queue."), type: "select", options: [{ value: "block", label: tx("Block the booking") }, { value: "flag", label: tx("Allow & flag for review") }], levels: ALL, dependsOn: "fairness.linkedGroups.enabled" },
    ],
  },
  {
    id: "limits",
    title: tx("Booking limits"),
    description: tx("How much of a facility one student can reserve."),
    icon: "gauge",
    fields: [
      { path: "limits.perDay", label: tx("Per day"), help: tx("Bookings per student per day, within the rule scope."), type: "number", min: 1, max: 12, unit: "bookings", levels: ALL },
      { path: "limits.perWeek", label: tx("Per week"), help: tx("Bookings per student per week, within the rule scope."), type: "number", min: 1, max: 40, unit: "bookings", levels: ALL },
      { path: "limits.maxActive", label: tx("Upcoming at once"), help: tx("Upcoming bookings a student can hold at the same time, within the rule scope."), type: "number", min: 1, max: 20, unit: "bookings", levels: ALL },
      { path: "campus.maxActiveBookings", label: tx("Campus-wide upcoming limit"), help: tx("Upcoming bookings across every facility on campus."), type: "number", min: 1, max: 30, unit: "bookings", levels: ["global"] },
    ],
  },
  {
    id: "window",
    title: tx("Booking window"),
    description: tx("When sessions open and close for booking."),
    icon: "calendar-range",
    fields: [
      { path: "window.advanceDays", label: tx("Book up to"), help: tx("How far ahead sessions can be booked. Shorter windows reduce hoarding of popular slots."), type: "number", min: 0, max: 60, unit: "days ahead", levels: ALL },
      { path: "window.releaseHour", label: tx("New days open at"), help: tx("Each day at this hour, the next day in the window opens for booking — the same moment for everyone, instead of midnight."), type: "number", min: 0, max: 23, unit: ":00", levels: ALL },
      { path: "window.minLeadMinutes", label: tx("Booking closes"), help: tx("Minutes before a session starts when booking closes."), type: "number", min: 0, max: 240, step: 5, unit: "min before", levels: ALL },
      { path: "approval.required", label: tx("Requires staff approval"), help: tx("Bookings stay pending until a staff member approves them."), type: "boolean", levels: ALL },
    ],
  },
  {
    id: "participants",
    title: tx("Participants"),
    description: tx("Who is on the booking — used for group fairness and check-in."),
    icon: "users",
    fields: [
      { path: "participants.required", label: tx("List participants"), help: tx("Students must invite everyone playing. Each player accepts from their own phone before the booking is confirmed."), type: "boolean", levels: ALL },
      { path: "participants.min", label: tx("Minimum people"), help: tx("Including the booker."), type: "number", min: 1, max: 30, unit: "people", levels: ALL, dependsOn: "participants.required" },
      { path: "participants.max", label: tx("Maximum people"), help: tx("Including the booker. Cannot exceed the facility capacity."), type: "number", min: 1, max: 60, unit: "people", levels: ALL },
      { path: "participants.acceptMinutes", label: tx("Time to accept"), help: tx("How long invited players have to accept. If too few accept in time, the booking is cancelled and the session reopens."), type: "number", min: 5, max: 1440, step: 5, unit: "min", levels: ALL },
    ],
  },
  {
    id: "cancellation",
    title: tx("Cancellation & check-in"),
    description: tx("What happens when plans change or students don’t turn up."),
    icon: "timer",
    fields: [
      { path: "cancellation.freeUntilMinutes", label: tx("Free cancellation until"), help: tx("Cancelling later than this is a late cancellation."), type: "number", min: 0, max: 2880, step: 15, unit: "min before", levels: ALL },
      { path: "cancellation.lateCountsAsStrike", label: tx("Late cancellation counts as a strike"), help: tx("Treat late cancellations like a missed session."), type: "boolean", levels: ALL },
      { path: "checkIn.opensMinutesBefore", label: tx("Check-in opens"), help: tx("Earliest time a student can be checked in."), type: "number", min: 0, max: 120, step: 5, unit: "min before", levels: ALL },
      { path: "checkIn.graceMinutes", label: tx("Grace period"), help: tx("After this many minutes without check-in, the booking becomes a no-show."), type: "number", min: 0, max: 60, step: 5, unit: "min after start", levels: ALL },
      { path: "checkIn.autoNoShow", label: tx("Mark no-shows automatically"), help: tx("The system marks the booking once the grace period ends."), type: "boolean", levels: ALL },
    ],
  },
  {
    id: "waitlist",
    title: tx("Waitlist"),
    description: tx("How freed-up spots are offered."),
    icon: "list-ordered",
    fields: [
      { path: "waitlist.enabled", label: tx("Enable waitlist"), help: tx("Students can queue for full sessions."), type: "boolean", levels: ALL },
      { path: "waitlist.maxPerSession", label: tx("Queue length"), help: tx("Maximum students waiting per session."), type: "number", min: 1, max: 50, unit: "students", levels: ALL, dependsOn: "waitlist.enabled" },
      { path: "waitlist.claimMinutes", label: tx("Time to claim a spot"), help: tx("How long the next student has to claim a freed spot before it moves on."), type: "number", min: 5, max: 240, step: 5, unit: "min", levels: ALL, dependsOn: "waitlist.enabled" },
      { path: "campus.maxActiveWaitlists", label: tx("Waitlists per student"), help: tx("How many waitlists a student can join at once."), type: "number", min: 1, max: 10, unit: "waitlists", levels: ["global"] },
    ],
  },
  {
    id: "noshow",
    title: tx("No-show ladder"),
    description: tx("Strikes build up with missed sessions and expire over time."),
    icon: "user-x",
    fields: [{ path: "noShow.strikeExpiryDays", label: tx("Strikes expire after"), help: tx("Missed sessions older than this no longer count."), type: "number", min: 7, max: 365, unit: "days", levels: ["global"] }],
  },
];

export const ALL_POLICY_FIELDS = POLICY_SCHEMA.flatMap((g) => g.fields);

/* ───────────────────────── Human-readable summaries ───────────────────────── */

export function fmtMinutes(min: number): string {
  const arM = (n: number) => arCount(n, "دقيقة", "دقيقتين", "دقائق", "دقيقة");
  const arH = (n: number) => arCount(n, "ساعة", "ساعتين", "ساعات", "ساعة");
  if (min < 60) return L(`${min} min`, arM(min));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return L(h === 1 ? "1 hour" : `${h} hours`, arH(h));
  return L(`${h} h ${m} min`, `${arH(h)} و${arM(m)}`);
}

export interface PolicyLine {
  icon: string;
  text: string;
  tone?: "default" | "fair";
}

/** Plain-language rules for students — generated, never hand-written. */
export function describePolicy(p: BookingPolicy, opts: { facilityName: string; categoryName: string; sessionMinutes: number; mode: "exclusive" | "shared" }): PolicyLine[] {
  const scope = p.fairness.scope === "category" ? L(`${opts.categoryName.toLowerCase()} facilities`, `مرافق ${opts.categoryName}`) : opts.facilityName;
  const lines: PolicyLine[] = [];
  const release = `${String(p.window.releaseHour ?? 0).padStart(2, "0")}:00`;
  lines.push({
    icon: "calendar",
    text:
      p.window.advanceDays === 0
        ? L(`Sessions can be booked on the day only, from ${release}.`, `الحجز متاح في نفس اليوم فقط، من الساعة ${release}.`)
        : L(`Book up to ${p.window.advanceDays} ${p.window.advanceDays === 1 ? "day" : "days"} ahead — each new day opens at ${release}.`, `احجز قبل الموعد بـ${N.day(p.window.advanceDays)} كحد أقصى — كل يوم جديد يُفتح حجزه الساعة ${release}.`),
  });
  lines.push({ icon: "hash", text: L(`${p.limits.perDay} ${p.limits.perDay === 1 ? "booking" : "bookings"} per day and ${p.limits.perWeek} per week across ${scope}.`, `${N.booking(p.limits.perDay)} في اليوم و${N.booking(p.limits.perWeek)} في الأسبوع في ${scope}.`) });
  if (p.fairness.maxConsecutive <= 1) {
    lines.push({ icon: "repeat", text: L("No back-to-back sessions — one session at a time per person.", "لا مواعيد متتالية — موعد واحد في كل مرة لكل شخص."), tone: "fair" });
  } else {
    lines.push({ icon: "repeat", text: L(`Up to ${p.fairness.maxConsecutive} sessions in a row (${fmtMinutes(p.fairness.maxConsecutive * opts.sessionMinutes)} max).`, `حتى ${N.session(p.fairness.maxConsecutive)} متتالية (${fmtMinutes(p.fairness.maxConsecutive * opts.sessionMinutes)} كحد أقصى).`), tone: "fair" });
  }
  if (p.fairness.restMinutes > 0) lines.push({ icon: "coffee", text: L(`Leave at least ${fmtMinutes(p.fairness.restMinutes)} between your sessions.`, `اترك ${fmtMinutes(p.fairness.restMinutes)} على الأقل بين مواعيدك.`), tone: "fair" });
  if (p.participants.required && opts.mode === "exclusive") lines.push({ icon: "users", text: L(`Invite ${p.participants.min}–${p.participants.max} players, you included. Each player accepts from their own phone, and the booking is confirmed once enough have accepted. Everyone on it follows the same limits.`, `ادعُ من ${p.participants.min} إلى ${p.participants.max} لاعبين بما فيهم أنت. كل لاعب يوافق من موبايله، ويتأكد الحجز عندما يوافق العدد الكافي. كل من في الحجز يخضع لنفس الحدود.`), tone: "fair" });
  if (p.fairness.linkedGroups.enabled) lines.push({ icon: "link", text: L("Groups who regularly play together can’t hold consecutive sessions, even from different accounts.", "المجموعات التي تلعب معًا باستمرار لا يمكنها حجز مواعيد متتالية، حتى من حسابات مختلفة."), tone: "fair" });
  lines.push({
    icon: "undo",
    text:
      p.cancellation.freeUntilMinutes > 0
        ? L(`Free cancellation until ${fmtMinutes(p.cancellation.freeUntilMinutes)} before the start${p.cancellation.lateCountsAsStrike ? " — later cancellations count as a missed session" : ""}.`, `الإلغاء مجاني حتى ${fmtMinutes(p.cancellation.freeUntilMinutes)} قبل البداية${p.cancellation.lateCountsAsStrike ? " — الإلغاء بعد ذلك يُحتسب موعدًا فائتًا" : ""}.`)
        : L("Cancel any time before the session starts.", "يمكنك الإلغاء في أي وقت قبل بداية الموعد."),
  });
  lines.push({ icon: "qr", text: L(`Check in with your QR code from ${p.checkIn.opensMinutesBefore} min before until ${p.checkIn.graceMinutes} min after the start.`, `سجّل حضورك بكود QR من ${fmtMinutes(p.checkIn.opensMinutesBefore)} قبل البداية حتى ${fmtMinutes(p.checkIn.graceMinutes)} بعدها.`) });
  if (p.approval.required) lines.push({ icon: "shield", text: L("Requests are reviewed by staff before they’re confirmed.", "يراجع الموظفون الطلبات قبل تأكيدها.") });
  return lines;
}
