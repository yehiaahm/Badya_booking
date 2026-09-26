import { z } from "zod";
import { ALL_POLICY_FIELDS } from "@/domain/policy";
import { ApiError } from "@/api/types";
import { localizeDeep } from "@/domain/localize";
import { api } from "./api";
import { GLOBAL_POLICY } from "./api/seed/catalog";

/**
 * The only functions reachable over HTTP, each with a schema for its
 * arguments. Anything not listed here can't be called, and every argument is
 * checked before backend code sees it. Permission checks still happen inside
 * each function.
 */

/* ───────────── Building blocks ───────────── */

const id = z.string().min(1).max(100);
const iso = z.string().min(10).max(40);
const text = (max: number) => z.string().max(max);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const hm = z.string().regex(/^\d{2}:\d{2}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const MOTIFS = ["football", "basketball", "tennis", "padel", "pool", "gym", "study", "pods", "meeting", "studio", "lab", "computer", "gaming", "music", "tabletennis", "volleyball", "billiards", "airhockey", "generic"] as const;
const AMENITIES = ["floodlights", "changing_rooms", "showers", "lockers", "equipment", "water", "ac", "wifi", "screen", "whiteboard", "power", "accessible", "parking", "seating", "sound", "first_aid", "coach", "towels"] as const;
const PERMISSIONS = ["facility.view", "booking.create", "booking.cancel.own", "waitlist.join", "schedule.view", "checkin.perform", "noshow.mark", "facility.report_issue", "facility.close_temporarily", "facility.manage", "category.manage", "booking.manage", "student.manage", "policy.manage", "maintenance.manage", "waitlist.manage", "fairness.review", "analytics.view", "audit.view", "staff.manage", "settings.manage", "policy.global.manage", "admin.manage", "role.manage", "security.manage"] as const;
const STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW", "EXPIRED", "WAITLISTED"] as const;

/**
 * Booking rules are validated against the real policy shape: every key must
 * exist in the campus defaults with the same type, and choice fields must use
 * one of their options. `partial` allows overrides that set only some fields.
 */
const selectOptions = new Map(ALL_POLICY_FIELDS.filter((f) => f.options).map((f) => [f.path, f.options!.map((o) => o.value)]));
function checkPolicy(value: unknown, template: unknown, path: string, partial: boolean): string | null {
  if (path === "noShow.ladder") {
    if (!Array.isArray(value) || value.length < 1 || value.length > 10) return `${path}: 1–10 steps`;
    for (const step of value) {
      const r = z.object({ strikes: int(1, 20), action: z.enum(["warning", "final_warning", "restrict"]), restrictDays: int(1, 365).optional() }).strict().safeParse(step);
      if (!r.success) return `${path}: invalid step`;
    }
    return null;
  }
  if (template && typeof template === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${path || "policy"}: expected an object`;
    const t = template as Record<string, unknown>;
    for (const [k, v] of Object.entries(value)) {
      if (!Object.prototype.hasOwnProperty.call(t, k)) return `${path ? path + "." : ""}${k}: unknown rule`;
      const err = checkPolicy(v, t[k], path ? `${path}.${k}` : k, partial);
      if (err) return err;
    }
    if (!partial) for (const k of Object.keys(t)) if (!(k in (value as object))) return `${path ? path + "." : ""}${k}: missing`;
    return null;
  }
  if (typeof value !== typeof template) return `${path}: wrong type`;
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0 || value > 100_000)) return `${path}: out of range`;
  if (typeof value === "string" && !(selectOptions.get(path) ?? []).includes(value)) return `${path}: not an allowed value`;
  return null;
}
const policy = (partial: boolean) =>
  z.custom<object>((v) => checkPolicy(v, GLOBAL_POLICY, "", partial) === null, { message: "Invalid booking rules." });

const facilityArabic = z
  .object({
    shortDescription: text(200).optional(),
    description: text(3000).optional(),
    rules: z.array(text(300)).max(20).optional(),
    unitLabel: text(30).optional(),
    building: text(120).optional(),
    area: text(120).optional(),
    floor: text(60).optional(),
    inactiveReason: text(200).optional(),
  })
  .strict();

const facility = z
  .object({
    id: z.string().regex(/^[a-z0-9_]{0,60}$/),
    name: text(80),
    nameAr: text(80).optional(),
    categoryId: id,
    shortDescription: text(200),
    description: text(3000),
    location: z.object({ building: text(120), area: text(120).optional(), floor: text(60).optional(), mapX: z.number().min(0).max(100), mapY: z.number().min(0).max(100) }).strict(),
    media: z.object({ motif: z.enum(MOTIFS), accent: hex, imageUrl: z.string().max(500).regex(/^https:\/\//).optional() }).strict(),
    mode: z.enum(["exclusive", "shared"]),
    units: int(1, 500),
    unitLabel: text(30).min(1),
    capacity: int(1, 200),
    sessionMinutes: int(15, 480),
    turnoverMinutes: int(0, 120),
    schedule: z.array(z.object({ open: hm, close: hm }).strict().nullable()).length(7),
    amenities: z.array(z.enum(AMENITIES)).max(30),
    rules: z.array(text(300)).max(20),
    policy: policy(true),
    access: z.object({ audiences: z.array(z.enum(["undergraduate", "postgraduate", "faculty_member", "staff"])).max(4), faculties: z.array(text(80)).max(40).nullable(), minYear: int(1, 7).nullable() }).strict(),
    status: z.enum(["active", "inactive"]),
    inactiveReason: text(200).optional(),
    createdAt: text(40),
    updatedAt: text(40),
    ar: facilityArabic.optional(),
  })
  .strict();

const category = z
  .object({
    id: z.string().regex(/^[a-z0-9_]{1,60}$/),
    name: text(80),
    nameAr: text(80).optional(),
    description: text(500),
    kind: z.enum(["sports", "wellness", "academic", "recreation", "other"]),
    motif: z.enum(MOTIFS),
    color: hex,
    policy: policy(true),
    sortOrder: int(0, 1000),
    active: z.boolean(),
    ar: z.object({ description: text(500).optional() }).strict().optional(),
  })
  .strict();

const settingsPatch = z
  .object({
    universityName: text(120).min(2),
    productName: text(60).min(2),
    timezone: text(60),
    weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]),
    qrRotationSeconds: int(10, 300),
    sessionTimeoutMinutes: int(5, 1440),
    bookingRateLimitPerMinute: int(1, 120),
    reminderMinutesBefore: int(5, 2880),
    supportEmail: z.string().email().max(120),
    allowedEmailDomains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)).min(1).max(10),
    maxDevicesPerStudent: int(1, 5),
  })
  .partial()
  .strict();

const bookingQuery = z
  .object({
    q: text(100).optional(),
    facilityId: id.optional(),
    statuses: z.array(z.enum(STATUSES)).max(10).optional(),
    from: iso.optional(),
    to: iso.optional(),
    sort: z.enum(["start_asc", "start_desc", "created_desc"]).optional(),
    page: int(1, 100_000).optional(),
    pageSize: int(1, 100_000).optional(),
    userId: id.optional(),
  })
  .strict();

const auditQuery = z.object({ q: text(100).optional(), role: text(20).optional(), entityType: text(20).optional(), page: int(1, 100_000).optional(), pageSize: int(1, 100_000).optional() }).strict();

/* ───────────── Registry ───────────── */

type Schemas = z.ZodType[];
interface MethodSpec {
  args: Schemas;
  /** Callable without signing in. */
  public?: boolean;
}

const M = (...args: Schemas): MethodSpec => ({ args });
const P = (...args: Schemas): MethodSpec => ({ args, public: true });

const REGISTRY: Record<string, Record<string, MethodSpec>> = {
  auth: {
    config: P(),
    signIn: P(text(200), text(200)),
    register: P(z.object({ name: text(100), nameAr: text(100).optional(), email: text(200), universityId: text(20), faculty: text(80), year: int(1, 7), level: z.enum(["undergraduate", "postgraduate"]), password: text(200) }).strict()),
    contactAdmin: P(text(2000), text(500).optional()),
    deviceRequestStatus: P(id),
    cancelDeviceRequest: P(id),
    demoSignIn: P(text(200)),
    me: P(),
    logout: P(),
    changePassword: M(text(200), text(200)),
  },
  facilities: {
    categories: M(),
    list: M(),
    get: M(id),
    availability: M(id, z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    evaluate: M(z.object({ facilityId: id, start: iso, participantIds: z.array(id).max(60) }).strict()),
  },
  bookings: {
    mine: M(),
    get: M(id),
    create: M(z.object({ facilityId: id, start: iso, participantIds: z.array(id).max(60), purpose: text(500).optional(), idempotencyKey: text(100) }).strict()),
    cancel: M(id, text(300)),
    leave: M(id),
    qr: M(id),
  },
  waitlist: {
    mine: M(),
    join: M(id, iso),
    leave: M(id),
    claim: M(id, z.array(id).max(60)),
  },
  me: {
    notifications: M(),
    markRead: M(z.union([z.literal("all"), z.array(id).max(500)])),
    favorites: M(),
    toggleFavorite: M(id),
    standing: M(),
    updatePreferences: M(z.object({ reminderMinutes: int(5, 2880), waitlistAlerts: z.boolean(), emailDigest: z.boolean(), language: z.enum(["en", "ar"]) }).partial().strict()),
    searchStudents: M(text(100)),
    teammates: M(),
  },
  staff: {
    overview: M(),
    scan: M(text(2000), id),
    checkIn: M(id, int(1, 200).optional()),
    markNoShow: M(id),
    undoNoShow: M(id, text(300)),
    reportIssue: M(z.object({ facilityId: id, category: z.enum(["equipment", "cleanliness", "safety", "lighting", "access", "other"]), severity: z.enum(["low", "medium", "high"]), description: text(1000) }).strict()),
    updateIssue: M(id, z.enum(["open", "in_progress", "resolved"])),
    closeTemporarily: M(z.object({ facilityId: id, minutes: int(5, 24 * 60), reason: text(300) }).strict()),
    reopen: M(id),
    scanCandidates: M(id),
  },
  admin: {
    dashboard: M(),
    facilities: M(),
    facility: M(id),
    saveFacility: M(facility, z.boolean()),
    setFacilityStatus: M(id, z.enum(["active", "inactive"]), text(200).optional()),
    saveCategory: M(category, z.boolean()),
    policies: M(),
    updateGlobalPolicy: M(policy(false), text(2000)),
    updateCategoryPolicy: M(id, policy(true), text(2000)),
    updateFacilityPolicy: M(id, policy(true), text(2000)),
    simulate: M(z.object({ userId: id, facilityId: id, start: iso, participantIds: z.array(id).max(60) }).strict()),
    bookings: M(bookingQuery),
    cancelBooking: M(id, text(300), z.boolean().optional()),
    decide: M(id, z.enum(["approved", "rejected"]), text(300).optional()),
    students: M(z.object({ q: text(100).optional(), level: text(20).optional(), faculty: text(80).optional(), page: int(1, 100_000).optional() }).strict()),
    student: M(id),
    restrict: M(id, int(1, 365), text(300)),
    liftRestriction: M(id, text(300)),
    waiveStrike: M(id, text(300)),
    deviceRequests: M(),
    decideDeviceRequest: M(id, z.enum(["approved", "rejected"]), text(300).optional()),
    resetStudentDevices: M(id, text(300)),
    resetPassword: M(id),
    flags: M(),
    resolveFlag: M(id, z.enum(["dismissed", "warned", "restricted"]), text(300)),
    maintenance: M(),
    maintenanceImpact: M(id, iso, iso),
    createMaintenance: M(z.object({ facilityId: id, start: iso, end: iso, reason: text(300) }).strict()),
    cancelMaintenance: M(id),
    waitlists: M(),
    removeWaitlistEntry: M(id),
    offerNextManually: M(id, iso),
    analytics: M(z.union([z.literal(7), z.literal(30), z.literal(90)])),
    audit: M(auditQuery),
    settings: M(),
    updateSettings: M(settingsPatch, text(2000)),
    updateRole: M(z.enum(["student", "staff", "admin", "super_admin"]), z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length)),
    team: M(),
    saveMember: M(
      z
        .object({
          id: id.optional(),
          name: text(100),
          email: text(200),
          title: text(120),
          role: z.enum(["student", "staff", "admin", "super_admin"]),
          assignedFacilityIds: z.array(id).max(100),
          status: z.enum(["active", "suspended"]),
        })
        .strict(),
    ),
  },
};

export function isPublic(ns: string, method: string) {
  return !!REGISTRY[ns]?.[method]?.public;
}

/** Validate and run `ns.method(...args)`. Throws ApiError for anything unknown or malformed. */
export async function dispatch(ns: string, method: string, rawArgs: unknown): Promise<unknown> {
  const spec = Object.prototype.hasOwnProperty.call(REGISTRY, ns) && Object.prototype.hasOwnProperty.call(REGISTRY[ns], method) ? REGISTRY[ns][method] : undefined;
  const fn = spec && (api as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[ns]?.[method];
  if (!spec || typeof fn !== "function") throw new ApiError("NOT_FOUND", "Unknown request.");
  if (!Array.isArray(rawArgs) || rawArgs.length > spec.args.length) throw new ApiError("VALIDATION", "Some of the information sent was invalid.");
  const args = spec.args.map((schema, i) => {
    // JSON has no `undefined` — a null argument means "not given".
    const r = schema.safeParse(rawArgs[i] === null ? undefined : rawArgs[i]);
    if (!r.success) {
      throw new ApiError("VALIDATION", "Some of the information sent was invalid. Refresh the page and try again.", undefined, { issues: r.error.issues.slice(0, 5).map((x) => `${i}.${x.path.join(".")}: ${x.message}`) });
    }
    return r.data;
  });
  const out = await fn(...args);
  return RAW.has(`${ns}.${method}`) ? out : localizeDeep(out);
}

/** Results used for editing keep both languages exactly as stored. */
const RAW = new Set(["admin.facility", "admin.facilities", "admin.settings"]);

export const registryForTests = REGISTRY;
