import type {
  AppNotification,
  AuditLog,
  AuthSession,
  Device,
  DeviceRequest,
  Credential,
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
  Role,
  SystemSettings,
  User,
  WaitlistEntry,
} from "@/domain/types";

/** The mock backend's database. Row tables are keyed by `id`. */
export interface DbState {
  /** anchor: when the database was created. demo: filled with generated sample data. */
  meta: { anchor: string; bookingSeq: number; seq: number; demo?: boolean };
  settings: SystemSettings;
  globalPolicy: BookingPolicy;
  roles: Role[];
  users: User[];
  categories: FacilityCategory[];
  facilities: Facility[];
  bookings: Booking[];
  waitlist: WaitlistEntry[];
  maintenance: MaintenancePeriod[];
  issues: FacilityIssue[];
  restrictions: Restriction[];
  flags: FairnessFlag[];
  notifications: AppNotification[];
  audit: AuditLog[];
  favorites: Favorite[];
  sessions: AuthSession[];
  devices: Device[];
  deviceRequests: DeviceRequest[];
  credentials: Credential[];
  /** Pre-aggregated history older than the live booking records. Never patched. */
  dailyStats: DailyStat[];
}

export const ROW_TABLES = ["users", "categories", "facilities", "bookings", "waitlist", "maintenance", "issues", "restrictions", "flags", "notifications", "audit", "favorites", "sessions", "devices", "deviceRequests", "credentials"] as const;
export type RowTable = (typeof ROW_TABLES)[number];
export const SINGLETONS = ["meta", "settings", "globalPolicy", "roles", "dailyStats"] as const;
export type Singleton = (typeof SINGLETONS)[number];

export const DEMO = {
  student: "u_yehia",
  staff: "u_staff_karim",
  admin: "u_admin_nour",
  superAdmin: "u_super_tamer",
} as const;
