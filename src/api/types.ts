import type { SessionInfo } from "@/domain/engine/sessions";
import type { Evaluation, RuleResult, SlotStatus } from "@/domain/engine/rules";
import type { Standing } from "@/domain/engine/standing";
import type { PolicyLine } from "@/domain/policy";
import type { RosterProblem } from "@/lib/roster";
import type {
  AppNotification,
  AuditLog,
  Booking,
  BookingPolicy,
  CorrectableField,
  DeviceRequest,
  Facility,
  FacilityCategory,
  FacilityIssue,
  FairnessFlag,
  ID,
  MaintenancePeriod,
  OpeningHours,
  ParticipantStatus,
  Restriction,
  RoleKey,
  RosterEntry,
  User,
  WaitlistEntry,
} from "@/domain/types";

/**
 * API contract. The mock implementation (src/api/mock) returns these shapes;
 * a production HTTP client would return the same JSON from the backend.
 */

export type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "RULE_VIOLATION" | "CONFLICT" | "VALIDATION" | "RATE_LIMITED" | "NETWORK";

export class ApiError extends Error {
  code: ErrorCode;
  details?: RuleResult[];
  data?: unknown;
  constructor(code: ErrorCode, message: string, details?: RuleResult[], data?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
    this.data = data;
  }
}

/** A user as other people see them — never includes contact details. */
export interface PublicUser {
  id: ID;
  name: string;
  avatarHue: number;
  role: RoleKey;
  universityId?: string;
  faculty?: string;
  year?: number;
}

export interface SessionUser extends User {
  permissions: string[];
  /** Signed in with a temporary password — the app asks for a new one before anything else. */
  mustChangePassword?: boolean;
}

export interface FacilitySummary {
  facility: Facility;
  category: FacilityCategory;
  isFavorite: boolean;
  today: { state: "open" | "few" | "full" | "closed" | "not_open" | "past"; bookable: number; hours: OpeningHours | null };
  next?: { start: string; end: string; remaining: number; capacity: number };
  openNow: boolean;
  maintenanceNow?: MaintenancePeriod;
  utilization7d: number;
}

export interface FacilityDetail extends FacilitySummary {
  policy: BookingPolicy;
  policyLines: PolicyLine[];
  /** Average booked share per hour of day (0–1), last 4 weeks. */
  popularTimes: number[];
  upcomingMaintenance: MaintenancePeriod[];
}

export interface SlotView {
  session: SessionInfo;
  status: SlotStatus;
  reasons: RuleResult[];
  warnings: RuleResult[];
  waitlistPosition?: number;
  waitlistEntryId?: ID;
  bookingId?: ID;
}

export interface DayChip {
  day: string; // yyyy-MM-dd
  state: "open" | "few" | "full" | "closed" | "not_open" | "past";
  bookable: number;
}

export interface Availability {
  facilityId: ID;
  day: string;
  slots: SlotView[];
  days: DayChip[];
}

export interface CancelInfo {
  allowed: boolean;
  late: boolean;
  penalty: boolean;
  freeUntil: string;
  reason?: string;
}

export interface BookingView extends Booking {
  facility: Facility;
  category: FacilityCategory;
  booker: PublicUser;
  /** Players who accepted (the booker is separate). */
  people: PublicUser[];
  /** Everyone the booker invited, with where each invitation stands. */
  team: { user: PublicUser; status: ParticipantStatus }[];
  /** AWAITING_PLAYERS: acceptances still needed to confirm the booking. */
  playersNeeded: number;
  /** Fewest and most people on this booking, the booker included. */
  peopleLimits: { min: number; max: number };
  unitName: string | null;
  /** "invited": the viewer has an invitation they haven't answered. */
  relation: "booker" | "participant" | "invited" | "staff";
  cancel: CancelInfo;
  checkInWindow: { opens: string; closes: string };
}

export interface BookingEvent {
  at: string;
  label: string;
  detail?: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
}

export interface BookingDetail extends BookingView {
  events: BookingEvent[];
  policyLines: PolicyLine[];
  waitlistCount: number;
}

export interface WaitlistView {
  entry: WaitlistEntry;
  facility: Facility;
  category: FacilityCategory;
  position: number;
  queueLength: number;
  claimMinutes: number;
}

export interface UsageLine {
  scopeId: ID;
  name: string;
  color: string;
  today: number;
  perDay: number;
  week: number;
  perWeek: number;
  active: number;
  maxActive: number;
}

export interface StandingInfo {
  standing: Standing;
  strikesDetail: { bookingId: ID; facilityName: string; type: "no_show" | "late_cancel"; at: string; expiresAt: string }[];
  usage: UsageLine[];
  campus: { active: number; maxActive: number; waitlists: number; maxWaitlists: number };
  /** The facilities office suspended the account: bookings can be seen and cancelled, nothing new. */
  suspended?: { reason?: string; since: string };
}

export interface CreateBookingInput {
  facilityId: ID;
  start: string;
  participantIds: ID[];
  purpose?: string;
  idempotencyKey: string;
}

export interface CreateBookingResult {
  booking: BookingView;
  flagged: boolean;
}

export interface CancelResult {
  booking: BookingView;
  offeredToNext: boolean;
}

export interface ScanCheck {
  label: string;
  status: "pass" | "fail" | "skip";
}

export interface ScanResult {
  ok: boolean;
  title: string;
  message: string;
  checks: ScanCheck[];
  booking?: BookingView;
  student?: PublicUser;
  alreadyCheckedIn?: boolean;
  /** Found by booking reference, not a live code: staff compare the student card, then confirm with checkIn. */
  verify?: boolean;
}

export interface StaffSessionBooking extends BookingView {
  canCheckIn: boolean;
  canMarkNoShow: boolean;
  late: boolean;
}

export interface StaffSession {
  facilityId: ID;
  start: string;
  end: string;
  unitCount: number;
  bookings: StaffSessionBooking[];
  state: "past" | "now" | "next" | "later";
  maintenance?: MaintenancePeriod;
}

export interface StaffFacilityToday {
  facility: Facility;
  category: FacilityCategory;
  sessions: StaffSession[];
  issues: FacilityIssue[];
  maintenance: MaintenancePeriod[];
  occupancyNow: { taken: number; capacity: number; checkedIn: number } | null;
  stats: { booked: number; checkedIn: number; noShows: number; utilization: number };
}

export interface StaffOverview {
  facilities: StaffFacilityToday[];
  totals: { booked: number; checkedIn: number; awaiting: number; noShows: number };
}

export interface ScanCandidate {
  label: string;
  hint: string;
  token: string;
  facilityId: ID;
  kind: "valid" | "wrong_facility" | "used" | "cancelled" | "wrong_day" | "expired" | "tampered";
}

/* ───────────── Admin ───────────── */

export interface Kpi {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
}

export interface AdminDashboard {
  kpis: {
    facilities: { active: number; total: number; maintenance: number };
    today: { bookings: number; checkedIn: number; upcoming: number; cancelled: number };
    activeNow: number;
    noShows: { today: number; rate7d: number; ratePrev7d: number };
    utilization: { today: number; last7d: number; prev7d: number };
    waitlist: { waiting: number; offered: number };
  };
  bookingsTrend: { day: string; booked: number; noShows: number; cancelled: number }[];
  utilizationByFacility: { facilityId: ID; name: string; color: string; value: number }[];
  heatmap: { weekday: number; hour: number; value: number }[];
  attention: { id: string; tone: "danger" | "warning" | "info"; title: string; detail: string; link: string }[];
  activity: AuditLog[];
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BookingQuery {
  q?: string;
  facilityId?: ID;
  statuses?: Booking["status"][];
  from?: string;
  to?: string;
  sort?: "start_asc" | "start_desc" | "created_desc";
  page?: number;
  pageSize?: number;
  userId?: ID;
}

export interface StudentRow {
  user: User;
  level: Standing["level"];
  strikes: number;
  activeBookings: number;
  totalBookings: number;
  noShows: number;
  restriction?: Restriction;
}

export interface StudentDetail extends StudentRow {
  standing: StandingInfo;
  bookings: BookingView[];
  restrictions: Restriction[];
  flags: FairnessFlag[];
  frequentPartners: { user: PublicUser; shared: number }[];
  devices: { label: string; boundAt?: string; lastSeenAt: string }[];
  pendingDeviceRequests: number;
  /** The student's entry on the official list — never the national-ID check itself. */
  official?: { name?: string; nameAr?: string; email?: string; faculty?: string; year?: number; level?: "undergraduate" | "postgraduate"; status: "active" | "inactive"; idCheck: boolean };
  /** Where each correctable detail comes from: the official list, a correction by the office, or what the student typed. */
  provenance: Record<CorrectableField, "official" | "office" | "student">;
  corrections: { field: CorrectableField; at: string; byName?: string }[];
  /** Who suspended or closed the account. */
  statusByName?: string;
}

export interface DeviceRequestView extends DeviceRequest {
  user: PublicUser & { email: string };
  otherUser?: PublicUser;
  /** Devices currently linked to the requesting student. */
  linkedDevices: { label: string; boundAt?: string; lastSeenAt: string }[];
  decidedByName?: string;
}

/** The official student list and how it lines up with registered accounts. */
export interface RosterSummary {
  /** Students on the list; 0 means no list is loaded — and registration is closed until one is. */
  count: number;
  updatedAt?: string;
  /** Graduated, withdrawn…: can't register or book. */
  inactive: number;
  /** Entries with national-ID digits — registration asks for them. */
  withIdCheck: number;
  /** Accounts whose university ID is on the list. */
  registered: number;
  /** Accounts that aren't on the list, or are inactive on it — they can't book or be invited. */
  outsideCount: number;
  outside: (PublicUser & { email: string; reason: "not_listed" | "inactive" })[];
  /** Accounts on the list whose email differs from the list's — check they belong to that student. */
  mismatchCount: number;
  mismatched: (PublicUser & { email: string; listedEmail: string })[];
}

/** What loading a student-list file does (or would do). */
export interface RosterImportReport {
  /** Students read from the file. */
  rows: number;
  /** Not on the current list. */
  added: number;
  /** On the current list with different details. */
  updated: number;
  unchanged: number;
  /** On the current list but not in the file — they lose access. */
  removed: number;
  /** Empty lines, ignored. */
  blank: number;
  /** Lines that can't be used (not counting duplicates). */
  invalid: number;
  /** Repeats of a university ID already in the file. */
  duplicates: number;
  inactive: number;
  withIdCheck: number;
  withEmail: number;
  accounts: { matched: number; updated: number; keptCorrections: number; outside: number; inactive: number; mismatched: number };
  /** The first rows as read — to check names and faculties came through (no national-ID data). */
  sample: Omit<RosterEntry, "idCheck">[];
  /** The first 100 problems; nothing is loaded while there are any. */
  problems: RosterProblem[];
  problemCount: number;
  /** The list was replaced (false for a preview). */
  applied: boolean;
}

export interface FlagView extends FairnessFlag {
  users: PublicUser[];
  bookings: BookingView[];
  facility: Facility;
}

export interface MaintenanceView extends MaintenancePeriod {
  facility: Facility;
  createdByName: string;
  state: "scheduled" | "active" | "completed" | "cancelled";
}

export interface ImpactPreview {
  bookings: BookingView[];
  waitlist: number;
}

export interface WaitlistSessionView {
  facility: Facility;
  category: FacilityCategory;
  start: string;
  end: string;
  entries: (WaitlistEntry & { user: PublicUser; position: number })[];
  remaining: number;
}

export interface AnalyticsData {
  rangeDays: number;
  totals: { bookings: number; attended: number; noShows: number; cancellations: number; waitlistJoins: number; utilization: number; uniqueStudents: number; avgLeadHours: number };
  prevTotals: { bookings: number; utilization: number; noShowRate: number; cancellationRate: number };
  daily: { day: string; booked: number; attended: number; noShows: number; cancellations: number }[];
  byFacility: { facilityId: ID; name: string; color: string; utilization: number; bookings: number; noShowRate: number; waitlist: number }[];
  byCategory: { categoryId: ID; name: string; color: string; bookings: number; noShowRate: number; cancellationRate: number }[];
  heatmap: { weekday: number; hour: number; value: number }[];
  byHour: number[];
  studentDistribution: { bucket: string; students: number }[];
  insights: { tone: "info" | "warning" | "success"; text: string }[];
}

export interface AuditQuery {
  q?: string;
  role?: string;
  entityType?: string;
  page?: number;
  pageSize?: number;
}

export interface TeamMember extends User {
  facilityNames: string[];
}

export type { Evaluation, RuleResult, AppNotification, FacilityCategory, Facility, BookingPolicy, MaintenancePeriod, FacilityIssue, WaitlistEntry, RosterEntry };
