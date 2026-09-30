/**
 * Domain model for Badya Spaces.
 *
 * These types are the contract between the UI, the booking engine and the
 * data layer. The mock API (src/api/mock) persists them locally; a real
 * backend would expose the same shapes over HTTP.
 */

export type ID = string;
/** ISO-8601 timestamp, e.g. "2026-09-25T18:00:00.000Z" */
export type ISO = string;

/* ───────────────────────────── Identity & access ───────────────────────────── */

export type RoleKey = "student" | "staff" | "admin" | "super_admin";

export type Permission =
  // student
  | "facility.view"
  | "booking.create"
  | "booking.cancel.own"
  | "waitlist.join"
  // staff
  | "schedule.view"
  | "checkin.perform"
  | "noshow.mark"
  | "facility.report_issue"
  | "facility.close_temporarily"
  // admin
  | "facility.manage"
  | "category.manage"
  | "booking.manage"
  | "student.manage"
  | "policy.manage"
  | "maintenance.manage"
  | "waitlist.manage"
  | "fairness.review"
  | "analytics.view"
  | "audit.view"
  | "staff.manage"
  | "settings.manage"
  // super admin
  | "policy.global.manage"
  | "admin.manage"
  | "role.manage"
  | "security.manage";

export interface Role {
  key: RoleKey;
  name: string;
  description: string;
  permissions: Permission[];
}

/** Who a facility can be booked by. */
export type Audience = "undergraduate" | "postgraduate" | "faculty_member" | "staff";

export interface UserPreferences {
  reminderMinutes: number;
  waitlistAlerts: boolean;
  emailDigest: boolean;
  language?: Language;
}

export type Language = "en" | "ar";

export type UserStatus = "active" | "suspended" | "deactivated";
/** Student details an administrator may correct. */
export type CorrectableField = "faculty" | "year";

export interface User {
  id: ID;
  role: RoleKey;
  name: string;
  nameAr?: string;
  email: string;
  /** Hue used for the generated avatar. */
  avatarHue: number;
  /**
   * suspended — students keep using the app read-only (no new bookings, waitlists or invitations);
   * staff and administrators are signed out. deactivated — the account is closed but kept for history;
   * its email and university ID are free for a new account.
   */
  status: UserStatus;
  /** Why and when an administrator last suspended or deactivated the account. */
  statusNote?: { reason: string; at: ISO; byUserId: ID };
  /** Student details an administrator corrected by hand. The official list doesn't overwrite them. */
  overrides?: Partial<Record<CorrectableField, { at: ISO; byUserId: ID }>>;
  createdAt: ISO;
  lastActiveAt?: ISO;
  // Students
  universityId?: string;
  faculty?: string;
  program?: string;
  year?: number;
  audience?: Audience;
  // Staff / admins
  title?: string;
  assignedFacilityIds?: ID[];
  preferences?: UserPreferences;
}

/* ───────────────────────────── Facilities ───────────────────────────── */

/** Visual motif used to render a facility's plan-view cover art. */
export type Motif =
  | "football"
  | "basketball"
  | "tennis"
  | "padel"
  | "pool"
  | "gym"
  | "study"
  | "pods"
  | "meeting"
  | "studio"
  | "lab"
  | "computer"
  | "gaming"
  | "music"
  | "tabletennis"
  | "volleyball"
  | "billiards"
  | "airhockey"
  | "generic";

export type CategoryKind = "sports" | "wellness" | "academic" | "recreation" | "other";

export interface FacilityCategory {
  id: ID;
  name: string;
  nameAr?: string;
  description: string;
  kind: CategoryKind;
  motif: Motif;
  /** Accent colour for this category (hex). */
  color: string;
  /** Category-level booking rule overrides (merged over the global policy). */
  policy: PolicyOverride;
  sortOrder: number;
  active: boolean;
  /** Retired: hidden everywhere except the admin archive. Only possible once none of its facilities are live. */
  archived?: { at: ISO; byUserId: ID };
  /** Arabic content. Missing fields fall back to English. */
  ar?: { description?: string };
}

/**
 * exclusive — each booking takes a whole space (a pitch, a court, a room).
 *             `units` is how many identical spaces exist.
 * shared    — each booking takes one spot in a shared space (gym, pool, lab).
 *             `units` is the number of spots per session.
 */
export type BookingMode = "exclusive" | "shared";

export interface OpeningHours {
  open: string; // "08:00"
  close: string; // "23:00"
}
/** Index 0 = Sunday … 6 = Saturday. null = closed that day. */
export type WeeklySchedule = (OpeningHours | null)[];

export type AmenityKey =
  | "floodlights"
  | "changing_rooms"
  | "showers"
  | "lockers"
  | "equipment"
  | "water"
  | "ac"
  | "wifi"
  | "screen"
  | "whiteboard"
  | "power"
  | "accessible"
  | "parking"
  | "seating"
  | "sound"
  | "first_aid"
  | "coach"
  | "towels";

export interface FacilityLocation {
  building: string;
  area?: string;
  floor?: string;
  /** Position on the campus aerial map, in percent. */
  mapX: number;
  mapY: number;
}

export interface Facility {
  id: ID;
  name: string;
  nameAr?: string;
  categoryId: ID;
  shortDescription: string;
  description: string;
  location: FacilityLocation;
  media: { motif: Motif; accent: string; imageUrl?: string };
  mode: BookingMode;
  units: number;
  unitLabel: string;
  /** Max people per booking (exclusive) — shared facilities are always 1. */
  capacity: number;
  sessionMinutes: number;
  /** Preparation / cleanup time after every session. Sessions never overlap it. */
  turnoverMinutes: number;
  schedule: WeeklySchedule;
  amenities: AmenityKey[];
  rules: string[];
  policy: PolicyOverride;
  access: { audiences: Audience[]; faculties: string[] | null; minYear: number | null };
  status: "active" | "inactive";
  inactiveReason?: string;
  /**
   * Retired: can't be booked, hidden from students and staff, kept for history and the admin archive.
   * `previousStatus` is what restoring it brings back.
   */
  archived?: { at: ISO; byUserId: ID; reason?: string; previousStatus: "active" | "inactive" };
  createdAt: ISO;
  updatedAt: ISO;
  /** Arabic content. Missing fields fall back to English. */
  ar?: FacilityArabic;
}

export interface FacilityArabic {
  shortDescription?: string;
  description?: string;
  rules?: string[];
  /** Singular, e.g. "ملعب" → "ملعب 1". */
  unitLabel?: string;
  building?: string;
  area?: string;
  floor?: string;
  inactiveReason?: string;
}

/* ───────────────────────────── Booking policy ───────────────────────────── */

export type NoShowAction = "warning" | "final_warning" | "restrict";

export interface NoShowStep {
  strikes: number;
  action: NoShowAction;
  restrictDays?: number;
}

/**
 * The fully-resolved rule set applied to a booking.
 * Resolution order: global → category → facility (later levels override).
 */
export interface BookingPolicy {
  window: {
    /** How many days ahead students can book (0 = today only). */
    advanceDays: number;
    /** Booking closes this many minutes before a session starts. */
    minLeadMinutes: number;
    /** Hour of the day (0–23) when the next day opens for booking — the same moment for everyone. */
    releaseHour: number;
  };
  limits: {
    perDay: number;
    perWeek: number;
    /** Upcoming bookings a student may hold at once within the rule scope. */
    maxActive: number;
  };
  fairness: {
    /** Apply limits per facility, or across every facility in the category. */
    scope: "facility" | "category";
    /** Max back-to-back sessions one person may hold. */
    maxConsecutive: number;
    /** Minimum rest between two separate stays by the same person. */
    restMinutes: number;
    /** Apply the rules to everyone listed on the booking, not just the booker. */
    applyToParticipants: boolean;
    linkedGroups: {
      enabled: boolean;
      lookbackDays: number;
      /** Students who shared this many sessions are treated as one group. */
      minSharedSessions: number;
      action: "block" | "flag";
    };
  };
  participants: {
    required: boolean;
    /** People including the booker. */
    min: number;
    max: number;
    /** Invited players have this long to accept before a booking that's short of players is cancelled. */
    acceptMinutes: number;
  };
  cancellation: {
    /** Free cancellation until this many minutes before start. */
    freeUntilMinutes: number;
    lateCountsAsStrike: boolean;
  };
  checkIn: {
    opensMinutesBefore: number;
    /** Minutes after start before a booking can be marked as a no-show. */
    graceMinutes: number;
    autoNoShow: boolean;
  };
  noShow: {
    strikeExpiryDays: number;
    ladder: NoShowStep[];
  };
  waitlist: {
    enabled: boolean;
    maxPerSession: number;
    /** Time a student has to claim a freed spot. */
    claimMinutes: number;
  };
  approval: { required: boolean };
  campus: {
    maxActiveBookings: number;
    maxActiveWaitlists: number;
  };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type PolicyOverride = DeepPartial<BookingPolicy>;

/* ───────────────────────────── Bookings ───────────────────────────── */

export type BookingStatus =
  /** Holding the session while invited players accept; cancelled if too few accept in time. */
  | "AWAITING_PLAYERS"
  | "PENDING"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW"
  | "EXPIRED"
  | "WAITLISTED";

/** invited → accepted or declined; an accepted player may later leave. Older records have no status and count as accepted. */
export type ParticipantStatus = "invited" | "accepted" | "declined" | "left";

export interface BookingParticipant {
  userId: ID;
  status?: ParticipantStatus;
  invitedAt?: ISO;
  respondedAt?: ISO;
  checkedIn?: boolean;
}

export interface Booking {
  id: ID; // BK-2026-001284
  facilityId: ID;
  userId: ID;
  /** For exclusive facilities with several spaces — which one (0-based). */
  unitIndex: number;
  start: ISO;
  end: ISO;
  status: BookingStatus;
  participants: BookingParticipant[];
  purpose?: string;
  source: "student" | "admin" | "waitlist";
  createdAt: ISO;
  updatedAt: ISO;
  /** Optimistic-concurrency version, bumped on every write. */
  version: number;
  /** AWAITING_PLAYERS: cancelled at this time unless enough invited players have accepted. */
  playersDeadline?: ISO;
  cancellation?: { at: ISO; byUserId: ID; reason: string; late: boolean; penalty: boolean; byRole: RoleKey | "system" };
  checkIn?: { at: ISO; byUserId: ID; method: "qr" | "manual"; headcount?: number };
  noShow?: { at: ISO; byUserId: ID | "system"; auto: boolean; waived?: { at: ISO; byUserId: ID; reason: string } };
  approval?: { at: ISO; byUserId: ID; decision: "approved" | "rejected"; note?: string };
  expiredAt?: ISO;
  reminderSentAt?: ISO;
}

export type WaitlistStatus = "waiting" | "offered" | "claimed" | "expired" | "left" | "cancelled";

export interface WaitlistEntry {
  id: ID;
  facilityId: ID;
  start: ISO;
  end: ISO;
  userId: ID;
  createdAt: ISO;
  status: WaitlistStatus;
  offeredAt?: ISO;
  offerExpiresAt?: ISO;
  bookingId?: ID;
}

/* ───────────────────────────── Operations ───────────────────────────── */

export interface MaintenancePeriod {
  id: ID;
  facilityId: ID;
  start: ISO;
  end: ISO;
  reason: string;
  kind: "planned" | "emergency" | "staff_closure";
  createdBy: ID;
  createdAt: ISO;
  affectedBookingIds: ID[];
  cancelled?: boolean;
}

export type IssueCategory = "equipment" | "cleanliness" | "safety" | "lighting" | "access" | "other";

export interface FacilityIssue {
  id: ID;
  facilityId: ID;
  reportedBy: ID;
  category: IssueCategory;
  severity: "low" | "medium" | "high";
  description: string;
  createdAt: ISO;
  status: "open" | "in_progress" | "resolved";
  resolvedAt?: ISO;
  resolvedBy?: ID;
}

export interface Restriction {
  id: ID;
  userId: ID;
  reason: string;
  source: "auto" | "admin";
  start: ISO;
  end: ISO;
  createdBy: ID | "system";
  lifted?: { at: ISO; byUserId: ID; reason: string };
}

export type FairnessFlagType = "linked_back_to_back" | "repeat_late_cancel" | "noshow_pattern";

export interface FairnessFlag {
  id: ID;
  type: FairnessFlagType;
  status: "open" | "dismissed" | "actioned";
  createdAt: ISO;
  facilityId: ID;
  userIds: ID[];
  bookingIds: ID[];
  summary: string;
  evidence: { sharedSessions: number; lookbackDays: number; occurrences: number };
  resolution?: { at: ISO; byUserId: ID; action: "dismissed" | "warned" | "restricted"; note?: string };
}

export type NotificationType =
  | "booking_confirmed"
  | "booking_pending"
  | "booking_approved"
  | "booking_rejected"
  | "booking_reminder"
  | "booking_cancelled"
  | "participant_added"
  | "invitation"
  | "invitation_response"
  | "waitlist_joined"
  | "slot_available"
  | "waitlist_expired"
  | "checkin_success"
  | "noshow_warning"
  | "restriction"
  | "maintenance"
  | "facility_reopened"
  | "fairness_notice"
  | "device_request"
  | "device_decision";

export interface AppNotification {
  id: ID;
  userId: ID;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: ISO;
  readAt?: ISO;
  link?: string;
  data?: { bookingId?: ID; waitlistId?: ID; facilityId?: ID; expiresAt?: ISO };
}

export interface AuditLog {
  id: ID;
  at: ISO;
  actorId: ID | "system";
  actorName: string;
  actorRole: RoleKey | "system";
  action: string; // e.g. "booking.cancel"
  entityType: "booking" | "facility" | "category" | "policy" | "user" | "maintenance" | "waitlist" | "issue" | "restriction" | "flag" | "settings" | "role" | "session" | "device";
  entityId: ID;
  entityLabel: string;
  summary: string;
  ip: string;
}

export interface Favorite {
  id: ID;
  userId: ID;
  facilityId: ID;
  createdAt: ISO;
}

/* ───────────────────────────── Sign-in & devices ───────────────────────────── */

/**
 * A browser the server has issued a device cookie to. Students are bound to
 * one device (by default) and a device holds one student account — anything
 * else needs an administrator's approval.
 */
export interface Device {
  /** SHA-256 of the device cookie token. The raw token never leaves the browser cookie. */
  id: ID;
  userId?: ID;
  /** e.g. "Chrome on Android" */
  label: string;
  userAgent: string;
  createdAt: ISO;
  boundAt?: ISO;
  lastSeenAt: ISO;
}

export interface DeviceRequest {
  id: ID;
  userId: ID;
  deviceId: ID;
  deviceLabel: string;
  /** new_device: the account is already bound elsewhere. device_in_use: this device belongs to another student. */
  kind: "new_device" | "device_in_use";
  /** The student currently bound to the device (device_in_use). */
  otherUserId?: ID;
  status: "pending" | "approved" | "rejected" | "cancelled";
  createdAt: ISO;
  decidedAt?: ISO;
  decidedBy?: ID;
  note?: string;
  /** What the student wrote to the facilities office when asking. */
  message?: string;
}

export interface AuthSession {
  /** SHA-256 of the session cookie token. */
  id: ID;
  userId: ID;
  deviceId: ID;
  createdAt: ISO;
  lastSeenAt: ISO;
  revokedAt?: ISO;
  /** Ended by the idle timeout — later requests with it can still say so. */
  idle?: boolean;
}

/** A user's password, kept apart from the user record so it never travels with it. Keyed by user id. */
export interface Credential {
  id: ID;
  hash: string;
  updatedAt: ISO;
  /** Wrong passwords in a row — the account pauses for a while after too many. */
  failures?: number;
  lockedUntil?: ISO;
  /** Set by an administrator (or generated): must be replaced at the next sign-in. */
  temporary?: boolean;
}

export interface SystemSettings {
  universityName: string;
  productName: string;
  timezone: string;
  /** 0 = Sunday … 6 = Saturday */
  weekStartsOn: 0 | 1 | 6;
  qrRotationSeconds: number;
  sessionTimeoutMinutes: number;
  bookingRateLimitPerMinute: number;
  reminderMinutesBefore: number;
  supportEmail: string;
  /** Sign-in is limited to these email domains, e.g. ["badya.edu.eg"]. */
  allowedEmailDomains: string[];
  /** Devices a student account may be bound to. Beyond this, an admin must approve. */
  maxDevicesPerStudent: number;
}

/** A phone or browser that asked to receive notifications for a user (Web Push). */
export interface PushSubscriptionRecord {
  /** SHA-256 of the push endpoint. */
  id: ID;
  userId: ID;
  deviceId: ID;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: ISO;
  lastSentAt?: ISO;
  failures?: number;
}

/** One student from the official list supplied by the university. Keyed by university ID. */
export interface RosterEntry {
  id: string;
  name?: string;
  nameAr?: string;
  email?: string;
  faculty?: string;
  year?: number;
  level?: "undergraduate" | "postgraduate";
  /** Graduated, withdrawn or otherwise not enrolled: can't register or book. Missing means active. */
  status?: "active" | "inactive";
  /**
   * Keyed hash of the last 4 digits of the student's national ID. When present, registering
   * with this university ID needs those digits — knowing someone's ID isn't enough.
   */
  idCheck?: string;
}

/** Pre-aggregated daily stats — the "analytics warehouse" for history. */
export interface DailyStat {
  date: string; // yyyy-MM-dd
  facilityId: ID;
  capacity: number; // bookable spot-sessions
  booked: number;
  attended: number;
  noShows: number;
  cancellations: number;
  waitlistJoins: number;
  byHour: number[]; // 24 buckets of booked spots
}
