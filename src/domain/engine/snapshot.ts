import { resolvePolicy } from "../policy";
import type {
  Booking,
  BookingParticipant,
  BookingPolicy,
  BookingStatus,
  Facility,
  FacilityCategory,
  ID,
  MaintenancePeriod,
  Restriction,
  User,
  WaitlistEntry,
} from "../types";

/** Everything the booking engine needs to make a decision. Pure data. */
export interface EngineSnapshot {
  now: Date;
  globalPolicy: BookingPolicy;
  weekStartsOn: 0 | 1 | 6;
  facilities: Facility[];
  categories: FacilityCategory[];
  bookings: Booking[];
  waitlist: WaitlistEntry[];
  maintenance: MaintenancePeriod[];
  restrictions: Restriction[];
  users: User[];
  /** The official student list by university ID. Null when no list has been uploaded. */
  roster?: ReadonlyMap<string, { status?: "active" | "inactive" }> | null;
}

/** Bookings that occupy a space. */
export const CAPACITY_STATUSES: ReadonlySet<BookingStatus> = new Set(["AWAITING_PLAYERS", "PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW"]);
/** Bookings that count towards a person's usage (limits, back-to-back, rest). */
export const USAGE_STATUSES: ReadonlySet<BookingStatus> = new Set(["AWAITING_PLAYERS", "PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW"]);
/** Bookings a student is still "holding". */
export const UPCOMING_STATUSES: ReadonlySet<BookingStatus> = new Set(["AWAITING_PLAYERS", "PENDING", "CONFIRMED"]);

/** A listed player who has agreed to play. Invitations don't count until accepted; older records have no status. */
export const hasJoined = (p: BookingParticipant) => !p.status || p.status === "accepted";

/** Everyone actually on a booking: the booker and the players who accepted. */
export const playersOf = (b: Booking): ID[] => [b.userId, ...b.participants.filter((p) => hasJoined(p) && p.userId !== b.userId).map((p) => p.userId)];

export const sessionKey = (facilityId: ID, startISO: string) => `${facilityId}|${startISO}`;

/**
 * Lazily-built lookup tables over a snapshot. Build one per data revision;
 * everything is read-only.
 */
export class EngineIndex {
  readonly s: EngineSnapshot;
  private _facilities?: Map<ID, Facility>;
  private _categories?: Map<ID, FacilityCategory>;
  private _users?: Map<ID, User>;
  private _byFacility?: Map<ID, Booking[]>;
  private _byPerson?: Map<ID, Booking[]>;
  private _waitlist?: Map<string, WaitlistEntry[]>;
  private _maintenance?: Map<ID, MaintenancePeriod[]>;
  private _policies = new Map<ID, BookingPolicy>();

  constructor(s: EngineSnapshot) {
    this.s = s;
  }

  get now() {
    return this.s.now;
  }

  facility(id: ID) {
    if (!this._facilities) this._facilities = new Map(this.s.facilities.map((f) => [f.id, f]));
    return this._facilities.get(id);
  }

  category(id: ID) {
    if (!this._categories) this._categories = new Map(this.s.categories.map((c) => [c.id, c]));
    return this._categories.get(id);
  }

  user(id: ID) {
    if (!this._users) this._users = new Map(this.s.users.map((u) => [u.id, u]));
    return this._users.get(id);
  }

  policyFor(facility: Facility): BookingPolicy {
    let p = this._policies.get(facility.id);
    if (!p) {
      p = resolvePolicy(this.s.globalPolicy, this.category(facility.categoryId), facility);
      this._policies.set(facility.id, p);
    }
    return p;
  }

  /** Facilities that share limits with this one (same facility, or whole category). */
  scopeFacilityIds(facility: Facility): Set<ID> {
    const p = this.policyFor(facility);
    if (p.fairness.scope === "facility") return new Set([facility.id]);
    return new Set(this.s.facilities.filter((f) => f.categoryId === facility.categoryId).map((f) => f.id));
  }

  bookingsForFacility(id: ID): Booking[] {
    if (!this._byFacility) {
      const m = new Map<ID, Booking[]>();
      for (const b of this.s.bookings) {
        const arr = m.get(b.facilityId);
        if (arr) arr.push(b);
        else m.set(b.facilityId, [b]);
      }
      this._byFacility = m;
    }
    return this._byFacility.get(id) ?? [];
  }

  /** Bookings a person is on — as the booker or as a player who accepted. Open invitations don't count. */
  involvements(userId: ID): Booking[] {
    if (!this._byPerson) {
      const m = new Map<ID, Booking[]>();
      const add = (uid: ID, b: Booking) => {
        const arr = m.get(uid);
        if (arr) arr.push(b);
        else m.set(uid, [b]);
      };
      for (const b of this.s.bookings) for (const uid of playersOf(b)) add(uid, b);
      this._byPerson = m;
    }
    return this._byPerson.get(userId) ?? [];
  }

  /** Whether a student may use the system under the official list (always true when no list is loaded). */
  onRoster(u: User | undefined): boolean {
    if (!this.s.roster) return true;
    // Inactive on the list (graduated, withdrawn…) counts as not on it.
    const entry = u?.universityId ? this.s.roster.get(u.universityId) : undefined;
    return !!entry && entry.status !== "inactive";
  }

  waitlistFor(facilityId: ID, startISO: string): WaitlistEntry[] {
    if (!this._waitlist) {
      const m = new Map<string, WaitlistEntry[]>();
      for (const w of this.s.waitlist) {
        const k = sessionKey(w.facilityId, w.start);
        const arr = m.get(k);
        if (arr) arr.push(w);
        else m.set(k, [w]);
      }
      for (const arr of m.values()) arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      this._waitlist = m;
    }
    return this._waitlist.get(sessionKey(facilityId, startISO)) ?? [];
  }

  maintenanceFor(facilityId: ID): MaintenancePeriod[] {
    if (!this._maintenance) {
      const m = new Map<ID, MaintenancePeriod[]>();
      for (const mp of this.s.maintenance) {
        if (mp.cancelled) continue;
        const arr = m.get(mp.facilityId);
        if (arr) arr.push(mp);
        else m.set(mp.facilityId, [mp]);
      }
      this._maintenance = m;
    }
    return this._maintenance.get(facilityId) ?? [];
  }

  activeRestriction(userId: ID, at = this.now): Restriction | undefined {
    const ts = at.getTime();
    return this.s.restrictions.find((r) => r.userId === userId && !r.lifted && new Date(r.start).getTime() <= ts && new Date(r.end).getTime() > ts);
  }
}
