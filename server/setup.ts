import { randomInt } from "node:crypto";
import { clock } from "@/lib/time";
import type { User } from "@/domain/types";
import { config } from "./config";
import { audit } from "./api/core";
import { db } from "./api/db";
import { MIN_PASSWORD, hashPassword, temporaryPassword } from "./password";
import { CATEGORIES, FACILITIES, GLOBAL_POLICY, ROLES, SETTINGS } from "./api/seed/catalog";
import { ROW_TABLES, type DbState } from "./api/state";

/** A brand-new database: the real catalogue and rules, no people or bookings. */
export function freshState(): DbState {
  const now = clock.now().toISOString();
  const s = {
    meta: { anchor: now, bookingSeq: 0, seq: 100 },
    settings: { ...SETTINGS, allowedEmailDomains: config.allowedEmailDomains },
    globalPolicy: structuredClone(GLOBAL_POLICY),
    roles: structuredClone(ROLES),
    dailyStats: [],
  } as unknown as Record<string, unknown>;
  for (const t of ROW_TABLES) s[t] = [];
  s.categories = structuredClone(CATEGORIES);
  s.facilities = structuredClone(FACILITIES).map((f) => ({ ...f, createdAt: now, updatedAt: now }));
  return s as unknown as DbState;
}

/**
 * Make sure there is someone who can administer the system. The first super
 * admin comes from BOOTSTRAP_ADMIN_EMAIL (and BOOTSTRAP_ADMIN_PASSWORD, or a
 * generated password printed once); everyone else is added from the admin console.
 */
export async function ensureAdmin() {
  const b = config.bootstrapAdmin;
  if (b) {
    let u = db.state.users.find((x) => x.email.toLowerCase() === b.email);
    const hasPassword = u && db.state.credentials.some((c) => c.id === u!.id);
    if (!u || !hasPassword) {
      const given = b.password && b.password.length >= MIN_PASSWORD ? b.password : undefined;
      if (b.password && !given) console.warn(`[setup] BOOTSTRAP_ADMIN_PASSWORD is shorter than ${MIN_PASSWORD} characters — a password was generated instead.`);
      const password = given ?? temporaryPassword();
      const hash = await hashPassword(password);
      await db.transaction(() => {
        if (!u) {
          u = { id: `u_admin_${randomInt(100000, 999999)}`, role: "super_admin", name: b.name, email: b.email, title: "System administrator", avatarHue: 230, status: "active", createdAt: clock.now().toISOString(), audience: "staff", assignedFacilityIds: [] } satisfies User;
          db.put("users", u);
          audit("system", "user.invite", "user", u.id, u.name, `Created the first super admin (${u.email}) from BOOTSTRAP_ADMIN_EMAIL`);
        }
        // Either way it's written down somewhere (.env or the server window): ask for a new one at first sign-in.
        db.put("credentials", { id: u.id, hash, updatedAt: clock.now().toISOString(), temporary: true });
      });
      console.log(given ? `[setup] Super admin ${b.email} can sign in with the password from BOOTSTRAP_ADMIN_PASSWORD.` : `[setup] Super admin ${b.email} — temporary password: ${password}  (shown once; change it after signing in)`);
    }
  }
  if (!db.state.users.some((u) => (u.role === "super_admin" || u.role === "admin") && u.status === "active")) {
    console.warn("[setup] No administrator exists yet. Set BOOTSTRAP_ADMIN_EMAIL in .env and restart the server.");
  }
}
