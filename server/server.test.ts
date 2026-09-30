import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createECDH, createHash, randomBytes } from "node:crypto";
import { addDays, format } from "date-fns";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RosterEntry } from "@/domain/types";
import type { RosterImportReport } from "@/api/types";
import { createRequire } from "node:module";
import webpush from "web-push";

/** The reference implementation of push-message encryption (RFC 8188), used here to decrypt what the server sends. */
const ece = createRequire(import.meta.url)("http_ece") as { decrypt(body: Buffer, params: { version: string; privateKey: ReturnType<typeof createECDH>; authSecret: string }): Buffer };

/**
 * End-to-end tests of the server's backend functions against a real SQLite
 * file: accounts and passwords, device binding, admin approval, validation
 * and concurrency.
 */

const dir = mkdtempSync(path.join(os.tmpdir(), "badya-test-"));
process.env.DATA_DIR = dir;

const { db } = await import("./api/db");
const { freshState } = await import("./setup");
const { requestContext } = await import("./context");
const { api } = await import("./api");
const { dispatch } = await import("./rpc");
const { resolveSession, hashToken } = await import("./api/auth");
const { hashPassword } = await import("./password");
const { ApiError } = await import("@/api/types");
const { localizeError } = await import("./messages");
const { tick, applyLadder } = await import("./api/core");
const { clock } = await import("@/lib/time");
const { usePushServiceForTests } = await import("./push");
const { signToken, tamper, windowOf } = await import("./api/qr");

type Ctx = Parameters<typeof requestContext.run>[0];
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36";
const device = (name: string): Ctx => ({ ip: `10.0.${name.length}.${name.charCodeAt(0)}`, userAgent: ANDROID, deviceId: createHash("sha256").update(name).digest("base64url"), sessionId: null, userId: null, language: "en", setCookies: [] });
const as = <T>(c: Ctx, fn: () => T) => requestContext.run(c, fn);
const sessionOf = (c: Ctx) => {
  const raw = [...c.setCookies].reverse().find((x) => x.startsWith("bs_session="));
  return raw ? hashToken(raw.split(";")[0].split("=")[1]) : null;
};
const PASSWORD = "correct horse battery";
let nextId = 20250000;
/** Put university IDs on the official student list — registration only accepts IDs on it. */
const onList = (...ids: string[]) => db.transaction(() => ids.forEach((id) => db.put("roster", { id })));
/** Sign in with the password; creates a student account the first time. */
async function signIn(c: Ctx, email: string, universityId = String(nextId++), password = PASSWORD) {
  if (!db.state.users.some((u) => u.email === email)) {
    await onList(universityId);
    return as(c, () => api.auth.register({ name: "Test Student", email, universityId, faculty: "Engineering", year: 2, level: "undergraduate", password }));
  }
  return as(c, () => api.auth.signIn(email, password));
}
const expectApiError = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(ApiError);
  expect((e as InstanceType<typeof ApiError>).code).toBe(code);
  return e as InstanceType<typeof ApiError>;
};
const userBy = (email: string) => db.state.users.find((u) => u.email === email)!;
/** A signed-in staff member or administrator made directly in the database. */
async function teamMember(id: string, role: "staff" | "admin", assignedFacilityIds: string[] = []): Promise<Ctx> {
  const hash = await hashPassword(PASSWORD);
  await db.transaction(() => {
    db.put("users", { id, role, name: `Team ${role}`, email: `${id}@badya.edu.eg`, avatarHue: 1, status: "active", createdAt: new Date().toISOString(), audience: "staff", assignedFacilityIds });
    db.put("credentials", { id, hash, updatedAt: new Date().toISOString() });
  });
  return { ...device(`${id}-laptop`), userId: id };
}

let admin: Ctx;

beforeAll(async () => {
  db.open(path.join(dir, "test.db"));
  db.replaceAll(freshState());
  const hash = await hashPassword(PASSWORD);
  await db.transaction(() => {
    db.put("users", { id: "u_admin", role: "super_admin", name: "Test Admin", email: "boss@badya.edu.eg", avatarHue: 1, status: "active", createdAt: new Date().toISOString(), audience: "staff", assignedFacilityIds: [] });
    db.put("credentials", { id: "u_admin", hash, updatedAt: new Date().toISOString() });
  });
  admin = device("admin-laptop");
  const r = await signIn(admin, "boss@badya.edu.eg");
  expect(r.status).toBe("signed_in");
  admin.userId = "u_admin";
});

// Each run gets its own throwaway database — don't leave it behind.
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("accounts and passwords", () => {
  it("only accepts university addresses, real IDs and long enough passwords", async () => {
    const base = { name: "New Student", universityId: "20880001", faculty: "Engineering", year: 1, level: "undergraduate" as const, password: PASSWORD };
    await expectApiError(as(device("x1"), () => api.auth.register({ ...base, email: "someone@gmail.com" })), "VALIDATION");
    await expectApiError(as(device("x2"), () => api.auth.register({ ...base, email: "ok@badya.edu.eg", universityId: "abc" })), "VALIDATION");
    await expectApiError(as(device("x3"), () => api.auth.register({ ...base, email: "ok@badya.edu.eg", password: "short" })), "VALIDATION");
  });

  it("rejects a second account with the same university ID or email", async () => {
    await signIn(device("dup-1"), "dup1@badya.edu.eg", "20990001");
    await onList("20990002");
    const base = { name: "Copy Cat", faculty: "Engineering", year: 1, level: "undergraduate" as const, password: PASSWORD };
    await expectApiError(as(device("dup-2"), () => api.auth.register({ ...base, email: "dup2@badya.edu.eg", universityId: "20990001" })), "CONFLICT");
    await expectApiError(as(device("dup-3"), () => api.auth.register({ ...base, email: "dup1@badya.edu.eg", universityId: "20990002" })), "CONFLICT");
  });

  it("signs in with the university ID too, and never stores the password itself", async () => {
    const c = device("by-id");
    await signIn(c, "byid@badya.edu.eg", "20770001");
    const r = await as({ ...c, setCookies: [] }, () => api.auth.signIn("20770001", PASSWORD));
    expect(r.status).toBe("signed_in");
    const u = userBy("byid@badya.edu.eg");
    expect(JSON.stringify(u)).not.toContain(PASSWORD);
    expect(db.state.credentials.find((x) => x.id === u.id)?.hash).toMatch(/^scrypt\$/);
    const detail = await as(admin, () => dispatch("admin", "student", [u.id]));
    expect(JSON.stringify(detail)).not.toMatch(/scrypt\$/);
  });

  it("pauses an account after repeated wrong passwords", async () => {
    const c = device("guesser");
    await signIn(c, "guessed@badya.edu.eg");
    for (let i = 0; i < 8; i++) await expectApiError(as(c, () => api.auth.signIn("guessed@badya.edu.eg", "wrong password")), "VALIDATION");
    await expectApiError(as(c, () => api.auth.signIn("guessed@badya.edu.eg", PASSWORD)), "RATE_LIMITED");
  });

  it("lets a signed-in user change their password", async () => {
    const c = device("changer");
    await signIn(c, "changer@badya.edu.eg");
    const me = { ...c, userId: userBy("changer@badya.edu.eg").id, sessionId: sessionOf(c) };
    await expectApiError(as(me, () => api.auth.changePassword("not it", "a brand new one")), "VALIDATION");
    await as(me, () => api.auth.changePassword(PASSWORD, "a brand new one"));
    await expectApiError(as({ ...c, setCookies: [] }, () => api.auth.signIn("changer@badya.edu.eg", PASSWORD)), "VALIDATION");
    expect((await as({ ...c, setCookies: [] }, () => api.auth.signIn("changer@badya.edu.eg", "a brand new one"))).status).toBe("signed_in");
  });

  it("an admin can give a student a new temporary password; students can't", async () => {
    const c = device("forgetful");
    await signIn(c, "forgetful@badya.edu.eg");
    const u = userBy("forgetful@badya.edu.eg");
    await expectApiError(as({ ...c, userId: u.id }, () => api.admin.resetPassword(u.id)), "FORBIDDEN");
    const { password } = await as(admin, () => api.admin.resetPassword(u.id));
    expect((await as({ ...c, setCookies: [] }, () => api.auth.signIn("forgetful@badya.edu.eg", password))).status).toBe("signed_in");
  });

  it("keeps students signed in on their own phone however long they're away", async () => {
    const c = device("long-away");
    await signIn(c, "away@badya.edu.eg");
    const s = db.state.sessions.find((x) => x.id === sessionOf(c))!;
    await db.transaction(() => db.put("sessions", { ...s, lastSeenAt: addDays(new Date(), -120).toISOString() }));
    expect(resolveSession(s.id, c.deviceId).userId).toBe(userBy("away@badya.edu.eg").id);
  });
});

describe("one device per student, one student per device", () => {
  const phoneA = device("phone-a");
  const phoneB = device("phone-b");

  it("links the first device automatically", async () => {
    const r = await signIn(phoneA, "sara@badya.edu.eg");
    expect(r.status).toBe("signed_in");
    const sara = userBy("sara@badya.edu.eg");
    expect(db.state.devices.find((d) => d.id === phoneA.deviceId)?.userId).toBe(sara.id);
    expect(db.state.devices.find((d) => d.id === phoneA.deviceId)?.label).toBe("Chrome on Android");
  });

  it("stops a second student on the same device until they contact the admin", async () => {
    await signIn(device("omar-own"), "omar@badya.edu.eg");
    const r = await signIn(phoneA, "omar@badya.edu.eg");
    expect(r).toMatchObject({ status: "device_locked", kind: "device_in_use" });
    // Nothing reaches the admin until the student asks.
    expect(db.state.deviceRequests.some((x) => x.userId === userBy("omar@badya.edu.eg").id)).toBe(false);
    if (r.status !== "device_locked") return;
    const sent = await as(phoneA, () => api.auth.contactAdmin(r.ticket, "My phone died, borrowing this one"));
    expect(sent).toMatchObject({ status: "device_approval", kind: "device_in_use" });
    const req = db.state.deviceRequests.find((x) => x.userId === userBy("omar@badya.edu.eg").id)!;
    expect(req.message).toBe("My phone died, borrowing this one");
    expect(db.state.notifications.some((n) => n.userId === "u_admin" && n.body.includes("My phone died"))).toBe(true);
  });

  it("stops the same student on a new device", async () => {
    const r = await signIn(phoneB, "sara@badya.edu.eg");
    expect(r).toMatchObject({ status: "device_locked", kind: "new_device" });
  });

  it("a request ticket only works on the device it was issued to", async () => {
    const r = await signIn(phoneB, "sara@badya.edu.eg");
    if (r.status !== "device_locked") throw new Error("expected a locked device");
    await expectApiError(as(device("elsewhere"), () => api.auth.contactAdmin(r.ticket)), "VALIDATION");
    await expectApiError(as(phoneB, () => api.auth.contactAdmin("forged.ticket")), "VALIDATION");
  });

  it("does not let another device read someone's request", async () => {
    const req = db.state.deviceRequests.find((r) => r.kind === "device_in_use")!;
    await expectApiError(as(phoneB, () => api.auth.deviceRequestStatus(req.id)), "NOT_FOUND");
  });

  it("approval moves the device and signs the previous student out of it", async () => {
    const saraSession = db.state.sessions.find((s) => s.deviceId === phoneA.deviceId && !s.revokedAt)!;
    expect(resolveSession(saraSession.id, phoneA.deviceId).userId).toBeTruthy();
    const req = db.state.deviceRequests.find((r) => r.kind === "device_in_use" && r.status === "pending")!;
    await as(admin, () => api.admin.decideDeviceRequest(req.id, "approved", "Checked ID"));
    expect(resolveSession(saraSession.id, phoneA.deviceId).userId).toBeNull();
    const c = { ...phoneA, setCookies: [] };
    const r = await as(c, () => api.auth.deviceRequestStatus(req.id));
    expect(r.status).toBe("signed_in");
    expect(resolveSession(sessionOf(c)!, phoneA.deviceId).userId).toBe(userBy("omar@badya.edu.eg").id);
  });

  it("a session never works from a different device", async () => {
    const s = db.state.sessions.find((x) => x.deviceId === phoneA.deviceId && !x.revokedAt)!;
    expect(resolveSession(s.id, phoneB.deviceId).userId).toBeNull();
  });

  it("resetting a student's devices lets their next device link without approval", async () => {
    const omar = userBy("omar@badya.edu.eg");
    await as(admin, () => api.admin.resetStudentDevices(omar.id, "Lost phone"));
    expect(db.state.devices.some((d) => d.userId === omar.id)).toBe(false);
    const r = await signIn(device("omar-new-phone"), "omar@badya.edu.eg");
    expect(r.status).toBe("signed_in");
  });

  it("moving a student off a device signs only that student out of it", async () => {
    const shared = device("shared-kiosk");
    await signIn(shared, "mona@badya.edu.eg");
    // A staff member signed in on the same browser must not be affected.
    await as({ ...shared, setCookies: [] }, () => api.auth.signIn("boss@badya.edu.eg", PASSWORD)).then((r) => expect(r.status).toBe("signed_in"));
    const staffSession = db.state.sessions.find((s) => s.deviceId === shared.deviceId && s.userId === "u_admin" && !s.revokedAt)!;
    const r = await signIn(device("mona-new"), "mona@badya.edu.eg");
    if (r.status !== "device_locked") throw new Error("expected a locked device");
    const sent = await as(device("mona-new"), () => api.auth.contactAdmin(r.ticket));
    if (sent.status !== "device_approval") throw new Error("expected a request");
    await as(admin, () => api.admin.decideDeviceRequest(sent.requestId, "approved"));
    expect(resolveSession(staffSession.id, shared.deviceId).userId).toBe("u_admin");
    expect(db.state.sessions.some((s) => s.deviceId === shared.deviceId && s.userId === userBy("mona@badya.edu.eg").id && !s.revokedAt)).toBe(false);
  });

  it("students can't approve device requests", async () => {
    const c = { ...device("omar-new-phone"), userId: userBy("omar@badya.edu.eg").id };
    await expectApiError(as(c, () => api.admin.deviceRequests()), "FORBIDDEN");
  });
});

describe("request validation", () => {
  const call = (ns: string, m: string, args: unknown) => as(admin, () => dispatch(ns, m, args));

  it("refuses unknown methods and internal helpers", async () => {
    await expectApiError(call("admin", "nope", []), "NOT_FOUND");
    await expectApiError(call("admin", "constructor", []), "NOT_FOUND");
    await expectApiError(call("toString", "call", []), "NOT_FOUND");
  });

  it("refuses extra or malformed arguments", async () => {
    await expectApiError(call("admin", "dashboard", [{ queryKey: ["x"] }]), "VALIDATION");
    await expectApiError(call("admin", "restrict", ["u", "seven", "reason"]), "VALIDATION");
  });

  it("only accepts real booking-rule keys and values", async () => {
    await expectApiError(call("admin", "updateCategoryPolicy", ["cat_team", { limits: { perDay: 2, hack: 1 } }, ""]), "VALIDATION");
    await expectApiError(call("admin", "updateCategoryPolicy", ["cat_team", { fairness: { scope: "everywhere" } }, ""]), "VALIDATION");
    await expectApiError(call("admin", "updateCategoryPolicy", ["cat_team", JSON.parse('{"__proto__":{"polluted":true}}'), ""]), "VALIDATION");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    await expect(call("admin", "updateCategoryPolicy", ["cat_team", { limits: { perDay: 2 } }, "test"])).resolves.not.toThrow();
  });
});

describe("Arabic", () => {
  it("answers in the reader's language and notifies in the recipient's", async () => {
    const c = device("arabic-reader");
    c.language = "ar";
    await signIn(c, "arabic1@badya.edu.eg");
    const me = db.state.users.find((u) => u.email === "arabic1@badya.edu.eg")!;
    c.userId = me.id;
    expect(me.preferences?.language).toBe("ar");

    // Facility content and rule explanations come back in Arabic.
    const detail = (await as(c, () => dispatch("facilities", "get", ["f_tennis"]))) as { facility: { name: string } };
    expect(detail.facility.name).toBe(db.state.facilities.find((f) => f.id === "f_tennis")!.nameAr);
    let start: string | undefined;
    for (let d = 1; d <= 3 && !start; d++) {
      const av = await as(c, () => api.facilities.availability("f_tennis", format(addDays(new Date(), d), "yyyy-MM-dd")));
      start = av.slots.find((s) => s.status === "available")?.session.start;
    }
    const e = await expectApiError(as(c, () => api.bookings.create({ facilityId: "f_tennis", start: start!, participantIds: [], idempotencyKey: "ar" })), "RULE_VIOLATION");
    expect(e.message).toMatch(/[\u0600-\u06FF]/);

    // An English-speaking admin's action reaches the student in Arabic; the audit log stays English.
    await as(admin, () => api.admin.resetStudentDevices(me.id, "Testing"));
    expect(db.state.notifications.filter((x) => x.userId === me.id).at(-1)!.title).toBe("تمت إعادة ضبط أجهزتك");
    expect(db.state.audit.at(-1)!.summary).toMatch(/^Unlinked/);
  });

  it("translates fixed error messages", () => {
    expect(localizeError("Please sign in to continue.", "ar")).toBe("من فضلك سجّل الدخول للمتابعة.");
    expect(localizeError("Please sign in to continue.", "en")).toBe("Please sign in to continue.");
  });
});

describe("security", () => {
  /** A signed-in context for an account made directly in the database. */
  async function member(id: string, role: "staff" | "admin", assignedFacilityIds: string[] = []): Promise<Ctx> {
    const hash = await hashPassword(PASSWORD);
    await db.transaction(() => {
      db.put("users", { id, role, name: `Test ${role}`, email: `${id}@badya.edu.eg`, avatarHue: 1, status: "active", createdAt: new Date().toISOString(), audience: "staff", assignedFacilityIds });
      db.put("credentials", { id, hash, updatedAt: new Date().toISOString() });
    });
    return { ...device(`${id}-laptop`), userId: id };
  }
  const nextFreeSlot = async (c: Ctx, facilityId: string) => {
    for (let d = 1; d <= 3; d++) {
      const av = await as(c, () => api.facilities.availability(facilityId, format(addDays(new Date(), d), "yyyy-MM-dd")));
      const s = av.slots.find((x) => x.status === "available")?.session.start;
      if (s) return s;
    }
    throw new Error("no free slot");
  };

  it("a lockout from one network doesn't lock the owner out elsewhere", async () => {
    const home = device("owner-home");
    await signIn(home, "owner@badya.edu.eg");
    const attacker = { ...device("attacker"), ip: "203.0.113.9" };
    for (let i = 0; i < 8; i++) await expectApiError(as(attacker, () => api.auth.signIn("owner@badya.edu.eg", "guess guess")), "VALIDATION");
    await expectApiError(as(attacker, () => api.auth.signIn("owner@badya.edu.eg", PASSWORD)), "RATE_LIMITED");
    expect((await as({ ...home, setCookies: [] }, () => api.auth.signIn("owner@badya.edu.eg", PASSWORD))).status).toBe("signed_in");
    expect(db.state.audit.some((a) => a.action === "session.locked" && a.entityId === userBy("owner@badya.edu.eg").id)).toBe(true);
  });

  it("refuses passwords made from the student's own ID or email", async () => {
    const base = { name: "Weak Password", faculty: "Engineering", year: 1, level: "undergraduate" as const };
    await expectApiError(as(device("weak-1"), () => api.auth.register({ ...base, email: "weakling@badya.edu.eg", universityId: "20661234", password: "20661234" })), "VALIDATION");
    await expectApiError(as(device("weak-2"), () => api.auth.register({ ...base, email: "weakling@badya.edu.eg", universityId: "20661234", password: "weakling99" })), "VALIDATION");
    await expectApiError(as(device("weak-3"), () => api.auth.register({ ...base, email: "weakling@badya.edu.eg", universityId: "20661234", password: "12345678" })), "VALIDATION");
    await expectApiError(as(device("weak-4"), () => api.auth.register({ ...base, name: "=cmd|' /C calc'!A0", email: "formula@badya.edu.eg", universityId: "20661235", password: PASSWORD })), "VALIDATION");
  });

  it("an administrator can't demote, rename or suspend a super admin, or turn a student into staff", async () => {
    const adminCtx = await member("u_plain_admin", "admin");
    const boss = userBy("boss@badya.edu.eg");
    await expectApiError(as(adminCtx, () => api.admin.saveMember({ id: boss.id, name: boss.name, email: boss.email, title: "", role: "staff", assignedFacilityIds: [], status: "active" })), "FORBIDDEN");
    await expectApiError(as(adminCtx, () => api.admin.saveMember({ id: boss.id, name: "Someone Else", email: "evil@badya.edu.eg", title: "", role: "super_admin", assignedFacilityIds: [], status: "active" })), "FORBIDDEN");
    await expectApiError(as(adminCtx, () => api.admin.resetPassword(boss.id)), "FORBIDDEN");
    const student = userBy("sara@badya.edu.eg");
    await expectApiError(as(adminCtx, () => api.admin.saveMember({ id: student.id, name: student.name, email: student.email, title: "", role: "staff", assignedFacilityIds: [], status: "active" })), "FORBIDDEN");
    await expectApiError(as(adminCtx, () => api.admin.saveMember({ name: "Copy Of Boss", email: boss.email, title: "", role: "staff", assignedFacilityIds: [], status: "active" })), "CONFLICT");
    expect(userBy("boss@badya.edu.eg").role).toBe("super_admin");
  });

  it("facility staff only work on the facilities they're assigned to", async () => {
    const staff = await member("u_tennis_staff", "staff", ["f_tennis"]);
    const report = (facilityId: string) => as(staff, () => api.staff.reportIssue({ facilityId, category: "equipment", severity: "low", description: "The net is sagging a little" }));
    await expectApiError(report("f_football"), "FORBIDDEN");
    await expect(report("f_tennis")).resolves.toMatchObject({ facilityId: "f_tennis" });
    await expectApiError(as(staff, () => api.staff.closeTemporarily({ facilityId: "f_padel", minutes: 30, reason: "Wet floor" })), "FORBIDDEN");
  });

  it("the student directory can't be harvested", async () => {
    const c = device("searcher");
    await signIn(c, "searcher@badya.edu.eg");
    const me = { ...c, userId: userBy("searcher@badya.edu.eg").id };
    expect(await as(me, () => api.me.searchStudents("2099"))).toEqual([]);
    expect(await as(me, () => api.me.searchStudents("Te"))).toEqual([]);
    const hit = await as(me, () => api.me.searchStudents("20990001"));
    expect(hit).toHaveLength(1);
    expect(hit[0].universityId).toBe("•••001");
  });

  it("an invited player decides from their own phone; strangers can't answer for them", async () => {
    const booker = device("booker-phone");
    const friend = device("friend-phone");
    await signIn(booker, "booker@badya.edu.eg");
    await signIn(friend, "friend@badya.edu.eg");
    const b = { ...booker, userId: userBy("booker@badya.edu.eg").id };
    const f = { ...friend, userId: userBy("friend@badya.edu.eg").id };
    const start = await nextFreeSlot(b, "f_tennis");
    const { booking } = await as(b, () => api.bookings.create({ facilityId: "f_tennis", start, participantIds: [f.userId!], idempotencyKey: "leave-test" }));
    expect(booking.status).toBe("AWAITING_PLAYERS");
    const stranger = { ...device("stranger"), userId: userBy("sara@badya.edu.eg").id };
    await expectApiError(as(stranger, () => api.bookings.respond(booking.id, "accept")), "NOT_FOUND");
    await expectApiError(as(stranger, () => api.bookings.get(booking.id)), "NOT_FOUND");
    await as(f, () => api.bookings.respond(booking.id, "decline"));
    expect(db.state.bookings.find((x) => x.id === booking.id)).toMatchObject({ status: "AWAITING_PLAYERS", participants: [{ userId: f.userId, status: "declined" }] });
  });

  it("a temporary password has to be replaced after signing in", async () => {
    const c = device("temp-pass");
    await signIn(c, "temporary@badya.edu.eg");
    const u = userBy("temporary@badya.edu.eg");
    const { password } = await as(admin, () => api.admin.resetPassword(u.id));
    const r = await as({ ...c, setCookies: [] }, () => api.auth.signIn("temporary@badya.edu.eg", password));
    if (r.status !== "signed_in") throw new Error("expected sign-in");
    expect(r.user.mustChangePassword).toBe(true);
    const me = { ...c, userId: u.id, sessionId: sessionOf(c) };
    await as(me, () => api.auth.changePassword(password, "my own new password"));
    expect((await as(me, () => api.auth.me()))?.mustChangePassword).toBe(false);
  });

  it("demo sign-in is refused without demo data", async () => {
    await expectApiError(as(device("demo-try"), () => api.auth.demoSignIn("boss@badya.edu.eg")), "FORBIDDEN");
  });

  it("limits waiting device requests and tells the account owner about them", async () => {
    await signIn(device("popular-own"), "popular@badya.edu.eg");
    const u = userBy("popular@badya.edu.eg");
    for (let i = 0; i < 4; i++) {
      const c = device(`popular-new-${i}`);
      const r = await signIn(c, "popular@badya.edu.eg");
      if (r.status !== "device_locked") throw new Error("expected a locked device");
      if (i < 3) await as(c, () => api.auth.contactAdmin(r.ticket, "new phone"));
      else await expectApiError(as(c, () => api.auth.contactAdmin(r.ticket, "new phone")), "RATE_LIMITED");
    }
    expect(db.state.notifications.filter((n) => n.userId === u.id && n.type === "device_request")).toHaveLength(3);
  });

  it("no one can look up where other students will be", async () => {
    await expectApiError(as(admin, () => dispatch("me", "clashes", [new Date().toISOString(), new Date().toISOString(), ["u_admin"]])), "NOT_FOUND");
  });
});

describe("bookings", () => {
  it("lets exactly one of two students take the last table", async () => {
    const a = device("race-a");
    const b = device("race-b");
    await signIn(a, "racer1@badya.edu.eg");
    await signIn(b, "racer2@badya.edu.eg");
    a.userId = db.state.users.find((u) => u.email === "racer1@badya.edu.eg")!.id;
    b.userId = db.state.users.find((u) => u.email === "racer2@badya.edu.eg")!.id;
    // The next open air-hockey session in the coming days (the Activity Center is closed on Fridays).
    let start: string | undefined;
    for (let d = 1; d <= 3 && !start; d++) {
      const av = await as(a, () => api.facilities.availability("f_airhockey", format(addDays(new Date(), d), "yyyy-MM-dd")));
      start = av.slots.find((s) => s.status === "available")?.session.start;
    }
    expect(start).toBeDefined();
    const results = await Promise.allSettled([
      as(a, () => api.bookings.create({ facilityId: "f_airhockey", start: start!, participantIds: [], idempotencyKey: "a" })),
      as(b, () => api.bookings.create({ facilityId: "f_airhockey", start: start!, participantIds: [], idempotencyKey: "b" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((failed.reason as InstanceType<typeof ApiError>).code).toBe("CONFLICT");
  });

  it("keeps everything after a restart", async () => {
    const before = { users: db.state.users.length, bookings: db.state.bookings.length, devices: db.state.devices.length };
    db.close();
    db.open(path.join(dir, "test.db"));
    expect({ users: db.state.users.length, bookings: db.state.bookings.length, devices: db.state.devices.length }).toEqual(before);
  });
});

/* ───────────── Fair play: each of these used to be a way round the rules ───────────── */

/** Campus time h:m, `dayOffset` days from today. */
const at = (dayOffset: number, h: number, m = 0) => {
  const d = addDays(new Date(), dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
/** The next day (1–2 ahead) the Activity Center is open — it's closed on Fridays. */
const activityDay = () => [1, 2].find((d) => addDays(new Date(), d).getDay() !== 5)!;
type Student = Ctx & { userId: string };
async function student(email: string, name = "Test Student"): Promise<Student> {
  const c = device(`${email}-phone`);
  const universityId = String(nextId++);
  await onList(universityId);
  const r = await as(c, () => api.auth.register({ name, email, universityId, faculty: "Engineering", year: 2, level: "undergraduate", password: PASSWORD }));
  expect(r.status).toBe("signed_in");
  return { ...c, setCookies: [], userId: userBy(email).id };
}
/** `n` back-to-back sessions that are all free, within the next few days. */
async function freeRun(c: Ctx, facilityId: string, n: number): Promise<string[]> {
  for (let d = 1; d <= 3; d++) {
    const av = await as(c, () => api.facilities.availability(facilityId, format(addDays(new Date(), d), "yyyy-MM-dd")));
    for (let i = 0; i + n <= av.slots.length; i++) {
      const run = av.slots.slice(i, i + n);
      if (run.every((s) => s.status === "available")) return run.map((s) => s.session.start);
    }
  }
  throw new Error("no free run");
}
const bookingById = (id: string) => db.state.bookings.find((b) => b.id === id)!;
const teamUsage = async (s: Student) => (await as(s, () => api.me.standing())).usage.find((u) => u.scopeId === "cat_team")!;

describe("fair play", () => {
  // An earlier test edits the Team Sports rules; start from the real ones.
  beforeAll(async () => {
    const { CATEGORIES } = await import("./api/seed/catalog");
    for (const c of CATEGORIES) await as(admin, () => api.admin.updateCategoryPolicy(c.id, c.policy, "Restore the catalogue rules"));
  });

  it("invited players count only once they accept, and the booking is confirmed only when enough have", async () => {
    const team: Student[] = [];
    for (const n of ["one", "two", "three", "four", "five", "six"]) team.push(await student(`team.${n}@badya.edu.eg`));
    const [booker, ...players] = team;
    const [start] = await freeRun(booker, "f_football", 1);
    const { booking } = await as(booker, () => api.bookings.create({ facilityId: "f_football", start, participantIds: players.map((p) => p.userId), idempotencyKey: "invite-flow" }));
    expect(booking.status).toBe("AWAITING_PLAYERS");
    expect(booking.playersNeeded).toBe(5);
    expect(new Date(booking.playersDeadline!).getTime()).toBeGreaterThan(Date.now());
    // Nothing is charged to an invited player yet, and there's no ticket until the players are in.
    expect((await teamUsage(players[0])).week).toBe(0);
    await expectApiError(as(booker, () => api.bookings.qr(booking.id)), "CONFLICT");
    for (const p of players.slice(0, 4)) await as(p, () => api.bookings.respond(booking.id, "accept"));
    expect(bookingById(booking.id).status).toBe("AWAITING_PLAYERS");
    const last = await as(players[4], () => api.bookings.respond(booking.id, "accept"));
    expect(last.status).toBe("CONFIRMED");
    expect(bookingById(booking.id).playersDeadline).toBeUndefined();
    expect((await teamUsage(players[0])).week).toBe(1);
  });

  it("list-then-leave: when players leave, the booking goes back on hold and is cancelled if nobody replaces them", async () => {
    const g: Student[] = [];
    for (const n of ["adam", "bassem", "celine", "dina", "emad", "farid", "galal"]) g.push(await student(`${n}.fc@badya.edu.eg`));
    const [s1, s2] = await freeRun(g[0], "f_football", 2);
    const { booking } = await as(g[0], () => api.bookings.create({ facilityId: "f_football", start: s1, participantIds: g.slice(1, 6).map((p) => p.userId), idempotencyKey: "ltl-1" }));
    for (const p of g.slice(1, 6)) await as(p, () => api.bookings.respond(booking.id, "accept"));
    expect(bookingById(booking.id).status).toBe("CONFIRMED");
    // While they're on it, the same friends can't take the next hour.
    const e = await expectApiError(as(g[1], () => api.bookings.create({ facilityId: "f_football", start: s2, participantIds: g.slice(2, 7).map((p) => p.userId), idempotencyKey: "ltl-2" })), "RULE_VIOLATION");
    expect(e.details!.map((d) => d.code)).toContain("consecutive");
    // Leaving doesn't leave one person holding the pitch: the booking goes back on hold…
    for (const p of g.slice(1, 6)) await as(p, () => api.bookings.leave(booking.id));
    expect(bookingById(booking.id).status).toBe("AWAITING_PLAYERS");
    expect(bookingById(booking.id).participants.map((p) => p.status)).toEqual(["left", "left", "left", "left", "left"]);
    // …and once the deadline passes without new players, it's cancelled without a strike and the session reopens.
    await db.transaction(() => db.put("bookings", { ...bookingById(booking.id), playersDeadline: new Date(Date.now() - 1000).toISOString() }));
    await as(admin, () => tick(true));
    expect(bookingById(booking.id)).toMatchObject({ status: "CANCELLED", cancellation: { reason: "Not enough players accepted in time", penalty: false, byRole: "system" } });
    const av = await as(g[6], () => api.facilities.availability("f_football", format(new Date(s1), "yyyy-MM-dd")));
    expect(av.slots.find((s) => s.session.start === s1)!.status).toBe("available");
  });

  it("an invitation can't be accepted once its deadline has passed", async () => {
    const booker = await student("late.booker@badya.edu.eg");
    const friend = await student("late.friend@badya.edu.eg");
    const [start] = await freeRun(booker, "f_tennis", 1);
    const { booking } = await as(booker, () => api.bookings.create({ facilityId: "f_tennis", start, participantIds: [friend.userId], idempotencyKey: "late" }));
    await db.transaction(() => db.put("bookings", { ...bookingById(booking.id), playersDeadline: new Date(Date.now() - 1000).toISOString() }));
    await expectApiError(as(friend, () => api.bookings.respond(booking.id, "accept")), "CONFLICT");
    await as(admin, () => tick(true));
    expect(bookingById(booking.id).status).toBe("CANCELLED");
  });

  it("adding a stranger doesn't use up their allowance — their own limits apply only if they accept", async () => {
    const victim = await student("victoria.mansour@badya.edu.eg", "Victoria Mansour");
    const partner = await student("paula.samir@badya.edu.eg", "Paula Samir");
    const griefer = await student("grim.neighbor@badya.edu.eg", "Grim Neighbor");
    const hit = (await as(griefer, () => api.me.searchStudents("vic"))).find((x) => x.name === "Victoria Mansour")!;
    const [padel] = await freeRun(griefer, "f_padel", 1);
    const { booking } = await as(griefer, () => api.bookings.create({ facilityId: "f_padel", start: padel, participantIds: [hit.id], idempotencyKey: "grief" }));
    expect(booking.status).toBe("AWAITING_PLAYERS");
    // Victoria can still book her own racket session that day.
    const day = new Date(padel);
    const tennis = (await as(victim, () => api.facilities.availability("f_tennis", format(day, "yyyy-MM-dd")))).slots.find((s) => s.status === "available" && Math.abs(new Date(s.session.start).getTime() - day.getTime()) >= 3 * 3600_000);
    expect(tennis).toBeDefined();
    await as(victim, () => api.bookings.create({ facilityId: "f_tennis", start: tennis!.session.start, participantIds: [partner.userId], idempotencyKey: "own" }));
    // Accepting the stranger's invitation now would break her own daily limit — she's told why, the griefer isn't.
    const e = await expectApiError(as(victim, () => api.bookings.respond(booking.id, "accept")), "RULE_VIOLATION");
    expect(e.details!.map((d) => d.code)).toContain("daily_limit");
    expect(e.message).toMatch(/^You’ve reached/);
  });

  it("every facility checks who is added: a 2-player table refuses extra people and unknown IDs", async () => {
    const host = await student("table.host@badya.edu.eg");
    const victim = userBy("victoria.mansour@badya.edu.eg");
    const e = await expectApiError(as(host, () => api.bookings.create({ facilityId: "f_airhockey", start: at(activityDay(), 10), participantIds: [victim.id, "not-a-student-1"], idempotencyKey: "ah" })), "RULE_VIOLATION");
    expect(e.details!.map((d) => d.code)).toEqual(expect.arrayContaining(["participants_count", "participant_invalid"]));
  });

  it("the rule check never reveals another student's bookings", async () => {
    const snoop = await student("nosy.parker@badya.edu.eg");
    const victim = userBy("victoria.mansour@badya.edu.eg");
    const hers = db.state.bookings.find((b) => b.userId === victim.id)!;
    const ev = await as(snoop, () => api.facilities.evaluate({ facilityId: "f_football", start: hers.start, participantIds: [victim.id] }));
    expect(ev.blocking.filter((b) => b.personId === victim.id)).toEqual([]);
  });

  it("each new day opens for booking at 09:00 — the same moment for everyone, not midnight", async () => {
    const s = await student("early.bird@badya.edu.eg");
    const ev = await as(s, () => api.facilities.evaluate({ facilityId: "f_tennis", start: at(4, 10), participantIds: [] }));
    const opens = new Date(ev.session!.opensAt!);
    expect([opens.getHours(), opens.getMinutes()]).toEqual([9, 0]);
    expect(ev.blocking.map((b) => b.code)).toContain("not_open");
  });
});

describe("notifications on the phone", () => {
  const sent: { headers: Record<string, string>; body: Buffer }[] = [];
  beforeAll(() => {
    usePushServiceForTests("push.test.local", async (sub, payload, options) => {
      const r = webpush.generateRequestDetails(sub, payload, options);
      sent.push({ headers: r.headers as Record<string, string>, body: r.body as Buffer });
    });
  });
  const keys = () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return { ecdh, p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
  };

  it("only accepts real push services, so the server can't be pointed at the university network", async () => {
    const s = await student("push.guard@badya.edu.eg");
    const k = keys();
    for (const endpoint of ["https://127.0.0.1/api/admin/x", "http://fcm.googleapis.com/fcm/send/abc", "https://intranet.badya.edu.eg/hook"]) {
      await expectApiError(as(s, () => api.me.subscribePush({ endpoint, keys: { p256dh: k.p256dh, auth: k.auth } })), "VALIDATION");
    }
    await as(s, () => api.me.subscribePush({ endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: k.p256dh, auth: k.auth } }));
    expect(db.state.pushSubscriptions.filter((x) => x.userId === s.userId)).toHaveLength(1);
  });

  it("delivers notifications, encrypted and signed, to the student's phone", async () => {
    const s = await student("push.me@badya.edu.eg");
    const k = keys();
    await as(s, () => api.me.subscribePush({ endpoint: "https://push.test.local/sub/1", keys: { p256dh: k.p256dh, auth: k.auth } }));
    sent.length = 0;
    await as(s, () => api.me.testPush());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const msg = sent[0];
    expect(msg.headers.Authorization).toMatch(/^vapid t=.+, k=.+/);
    expect(msg.headers["Content-Encoding"]).toBe("aes128gcm");
    const payload = JSON.parse(ece.decrypt(msg.body, { version: "aes128gcm", privateKey: k.ecdh, authSecret: k.auth }).toString("utf8"));
    expect(payload).toMatchObject({ title: "Notifications are on", link: "/profile" });
  });

  it("stops when the account leaves that phone", async () => {
    const s = userBy("push.me@badya.edu.eg");
    await as(admin, () => api.admin.resetStudentDevices(s.id, "Lost phone"));
    expect(db.state.pushSubscriptions.some((x) => x.userId === s.id)).toBe(false);
  });
});

describe("official student list", () => {
  // The list the rest of the suite registers against — put back after each test here.
  let saved: RosterEntry[] = [];
  beforeEach(() => {
    saved = db.state.roster;
  });
  afterEach(() => db.transaction(() => db.replaceTable("roster", saved)));
  const base = { name: "Fake Person", faculty: "Engineering", year: 1, level: "undergraduate" as const, password: PASSWORD };

  it("with the list loaded, made-up IDs can't register, book or be invited", async () => {
    const listed = "20550001";
    const report = await as(admin, () => api.admin.importRoster(`University ID,Name,Email,Faculty,Year
${listed},Listed Student,listed@badya.edu.eg,Pharmacy,3
20550002,,,,
`));
    expect(report).toMatchObject({ applied: true, rows: 2, added: 2, problemCount: 0 });
    await expectApiError(as(device("made-up-id"), () => api.auth.register({ ...base, email: "fake.person@badya.edu.eg", universityId: "20559999" })), "VALIDATION");
    await expectApiError(as(device("borrowed-id"), () => api.auth.register({ ...base, email: "not.them@badya.edu.eg", universityId: listed })), "VALIDATION");
    const r = await as(device("listed-phone"), () => api.auth.register({ ...base, name: "Typed Name", email: "listed@badya.edu.eg", universityId: listed }));
    expect(r.status).toBe("signed_in");
    expect(userBy("listed@badya.edu.eg")).toMatchObject({ name: "Listed Student", faculty: "Pharmacy", year: 3 });
    // Accounts made before the list that aren't on it can't book, and can't be invited.
    const outsider = { ...device("outsider"), userId: userBy("booker@badya.edu.eg").id };
    const ev = await as(outsider, () => api.facilities.evaluate({ facilityId: "f_airhockey", start: at(activityDay(), 10), participantIds: [] }));
    expect(ev.blocking.map((b) => b.code)).toContain("eligibility");
    const me = { ...device("listed-phone"), userId: userBy("listed@badya.edu.eg").id };
    const ev2 = await as(me, () => api.facilities.evaluate({ facilityId: "f_tennis", start: at(1, 10), participantIds: [outsider.userId!] }));
    expect(ev2.blocking.map((b) => b.code)).toContain("participant_invalid");
    const summary = await as(admin, () => api.admin.roster());
    expect(summary).toMatchObject({ count: 2, registered: 1 });
    expect(summary.outsideCount).toBeGreaterThan(5);
    await as(admin, () => api.admin.clearRoster("End of test"));
    expect((await as(admin, () => api.admin.roster())).count).toBe(0);
    // No list: registration is closed, but existing accounts keep working.
    const closed = await expectApiError(as(device("no-list"), () => api.auth.register({ ...base, email: "late.comer@badya.edu.eg", universityId: "20550003" })), "VALIDATION");
    expect(closed.message).toMatch(/official student list/);
    expect((await as(device("no-list"), () => api.auth.config())).studentList).toBe(false);
    const ev3 = await as(outsider, () => api.facilities.evaluate({ facilityId: "f_airhockey", start: at(activityDay(), 10), participantIds: [] }));
    expect(ev3.blocking.map((b) => b.code)).not.toContain("eligibility");
  });

  it("checks every line, reports each problem with its line number, and loads all or nothing", async () => {
    const before = db.state.roster;
    const file = `University ID,Name,Email,Faculty,Year,Status
20560001,Good Row,good.row@badya.edu.eg,Engineering,2,active
abc,Bad Id,,,,
20560001,Repeat,,,,
20560003,Bad Mail,someone@gmail.com,Engineering,2,
20560004,Bad Faculty,,Astrology,2,
20560005,Bad Year,,Engineering,9,
20560006,Bad Status,,Engineering,2,maybe

`;
    const preview = await as(admin, () => api.admin.previewRoster(file));
    expect(preview).toMatchObject({ applied: false, duplicates: 1, invalid: 5, problemCount: 6, blank: 1 });
    expect(preview.problems.map((p) => p.line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(preview.problems.map((p) => p.column)).toEqual(["id", "id", "email", "faculty", "year", "status"]);
    expect(db.state.roster).toBe(before);
    const e = await expectApiError(as(admin, () => api.admin.importRoster(file)), "VALIDATION");
    expect((e.data as { report: RosterImportReport }).report.problemCount).toBe(6);
    expect(db.state.roster).toBe(before);
    // A file with no ID column, or nothing in it, is explained too.
    expect((await as(admin, () => api.admin.previewRoster("Name,Email\nSomeone,x@badya.edu.eg\n"))).problems[0].message).toMatch(/University ID/);
    expect((await as(admin, () => api.admin.previewRoster(""))).problems[0].message).toMatch(/empty/);
  });

  it("reads Excel files in Arabic: byte-order mark, Arabic headers, digits and faculty names, semicolons", async () => {
    const bom = String.fromCharCode(0xfeff);
    const file = `${bom}الرقم الجامعي;الاسم;البريد الإلكتروني;الكلية;الفرقة;الحالة\r\n٢٠٥٧٠٠٠١;"منى حسن";Mona.H@Badya.edu.eg;كلية الصيدلة;٣;نشط\r\n20570002;عمر علي;;الهندسة;1;متخرج\r\n`;
    const report = await as(admin, () => api.admin.importRoster(file));
    expect(report).toMatchObject({ rows: 2, inactive: 1, problemCount: 0 });
    expect(report.sample[0]).toMatchObject({ id: "20570001", nameAr: "منى حسن", email: "mona.h@badya.edu.eg", faculty: "Pharmacy", year: 3 });
    const r = await as(device("mona-phone"), () => api.auth.register({ ...base, name: "Mona Hassan", email: "mona.h@badya.edu.eg", universityId: "٢٠٥٧٠٠٠١" }));
    expect(r.status).toBe("signed_in");
    expect(userBy("mona.h@badya.edu.eg")).toMatchObject({ name: "Mona Hassan", nameAr: "منى حسن", faculty: "Pharmacy", year: 3, universityId: "20570001" });
    // Graduated (inactive on the list): can't register.
    const e = await expectApiError(as(device("omar-phone"), () => api.auth.register({ ...base, name: "Omar Ali", email: "omar.ali@badya.edu.eg", universityId: "20570002" })), "VALIDATION");
    expect(e.message).toMatch(/isn’t active/);
  });

  it("knowing someone's university ID isn't enough: the national-ID digits on the list must match", async () => {
    const report = await as(admin, () => api.admin.importRoster(`University ID,Name,National ID
20580001,Real Owner,29901011234567
20580002,Second Owner,5678
`));
    expect(report.withIdCheck).toBe(2);
    // Only a keyed fingerprint is kept — never the digits.
    expect(JSON.stringify(db.state.roster)).not.toMatch(/4567|5678|2990101/);
    expect((await as(device("cfg"), () => api.auth.config())).idCheck).toBe(true);
    const guess = { ...base, name: "Real Owner", email: "real.owner@badya.edu.eg", universityId: "20580001" };
    await expectApiError(as(device("imp-0"), () => api.auth.register(guess)), "VALIDATION");
    for (let i = 1; i <= 5; i++) await expectApiError(as(device(`imp-${i}`), () => api.auth.register({ ...guess, nationalIdLast4: String(1000 + i) })), "VALIDATION");
    // Five wrong guesses pause that ID — even the right digits have to wait.
    await expectApiError(as(device("imp-6"), () => api.auth.register({ ...guess, nationalIdLast4: "4567" })), "RATE_LIMITED");
    expect(db.state.users.some((u) => u.universityId === "20580001")).toBe(false);
    await vi.waitFor(() => expect(db.state.audit.some((a) => a.action === "user.register_locked" && a.entityId === "20580001")).toBe(true));
    // Loading the (checked) list again lifts the pause, and the right digits work.
    await as(admin, () => api.admin.importRoster(`University ID,Name,National ID
20580001,Real Owner,29901011234567
20580002,Second Owner,5678
`));
    await vi.waitFor(async () => expect((await as(device("imp-7"), () => api.auth.register({ ...guess, nationalIdLast4: "4567" }))).status).toBe("signed_in"));
    // The real student, with the right digits (typed on an Arabic keyboard), gets in first time.
    const ok = await as(device("owner-2"), () => api.auth.register({ ...base, name: "Second Owner", email: "second.owner@badya.edu.eg", universityId: "20580002", nationalIdLast4: "٥٦٧٨" }));
    expect(ok.status).toBe("signed_in");
  });

  it("loading a list updates existing accounts — except what the office corrected by hand", async () => {
    const s = await student("recon@badya.edu.eg");
    const u = userBy("recon@badya.edu.eg");
    await as(admin, () => api.admin.updateStudent(u.id, { year: 4 }));
    const report = await as(admin, () => api.admin.importRoster(`University ID,Name,Email,Faculty,Year
${u.universityId},Official Name,someone.else@badya.edu.eg,Pharmacy,1
`));
    expect(report.accounts).toMatchObject({ matched: 1, updated: 1, keptCorrections: 1, mismatched: 1 });
    expect(userBy("recon@badya.edu.eg")).toMatchObject({ name: "Official Name", faculty: "Pharmacy", year: 4 });
    expect((await as(admin, () => api.admin.roster())).mismatched.map((m) => m.id)).toEqual([u.id]);
    const detail = await as(admin, () => api.admin.student(u.id));
    expect(detail.provenance).toEqual({ faculty: "official", year: "office" });
    await as(admin, () => api.admin.useOfficialValue(u.id, "year"));
    expect(userBy("recon@badya.edu.eg").year).toBe(1);
    await expectApiError(as(admin, () => api.admin.useOfficialValue(u.id, "year")), "CONFLICT");
    // The student can't correct their own record.
    await expectApiError(as(s, () => api.admin.updateStudent(u.id, { year: 7 })), "FORBIDDEN");
    await expectApiError(as(s, () => dispatch("me", "updatePreferences", [{ faculty: "Medicine" }])), "VALIDATION");
  });

  it("only the office can see, load or remove the list", async () => {
    const s = await student("list.peek@badya.edu.eg");
    const keeper = await teamMember("u_list_staff", "staff", ["f_tennis"]);
    const file = "University ID\n20590001\n";
    for (const who of [s, keeper]) {
      await expectApiError(as(who, () => api.admin.roster()), "FORBIDDEN");
      await expectApiError(as(who, () => api.admin.previewRoster(file)), "FORBIDDEN");
      await expectApiError(as(who, () => api.admin.importRoster(file)), "FORBIDDEN");
      await expectApiError(as(who, () => api.admin.clearRoster("Not mine to clear")), "FORBIDDEN");
    }
    await expectApiError(as(device("anon"), () => dispatch("admin", "importRoster", [file])), "UNAUTHENTICATED");
    expect(db.state.roster.some((r) => r.id === "20590001")).toBe(false);
  });
});

describe("updating an older database", () => {
  it("moves facility details still at an earlier default to today's catalogue, and keeps what an admin changed", async () => {
    const { migrate } = await import("./setup");
    const { FACILITIES, RETIRED_DEFAULTS } = await import("./api/seed/catalog");
    const pick = (id: string) => db.state.facilities.find((f) => f.id === id)!;
    const old = RETIRED_DEFAULTS.f_padel;
    const padel = pick("f_padel");
    await db.transaction(() => {
      // As the first version shipped it: 08:00–22:00, 90-minute sessions, floodlights and water.
      db.put("facilities", { ...padel, schedule: old.schedule as typeof padel.schedule, sessionMinutes: 90, amenities: ["floodlights", "water"], description: old.description as string, ar: { ...padel.ar, description: old["ar.description"] as string } });
      // Changed by an administrator — must be left alone.
      db.put("facilities", { ...pick("f_tennis"), sessionMinutes: 45, amenities: ["floodlights"] });
    });
    await as(admin, () => migrate());
    expect(pick("f_padel")).toMatchObject({ sessionMinutes: 30, amenities: [], schedule: pick("f_football").schedule });
    expect(pick("f_padel").description).toMatch(/30 minutes/);
    expect(pick("f_padel").ar?.description).toMatch(/30 دقيقة/);
    expect(pick("f_tennis")).toMatchObject({ sessionMinutes: 45, amenities: ["floodlights"] });
    // Running it again changes nothing.
    const before = JSON.stringify(db.state.facilities);
    await as(admin, () => migrate());
    expect(JSON.stringify(db.state.facilities)).toBe(before);
    await db.transaction(() => db.put("facilities", structuredClone(FACILITIES.find((f) => f.id === "f_tennis")!)));
  });
});

/* ───────────── Found by using the app end to end (audit, 29 Sep 2026) ───────────── */

describe("end-to-end audit regressions", () => {
  const withApproval = (on: boolean) => as(admin, () => api.admin.updateFacilityPolicy("f_airhockey", on ? { participants: { max: 2 }, approval: { required: true } } : { participants: { max: 2 } }, `Audit test: approval ${on ? "on" : "off"}`));
  const notesFor = (s: Student) => db.state.notifications.filter((n) => n.userId === s.userId);

  it("a request that fails part-way leaves nothing behind", async () => {
    const before = { restrictions: db.state.restrictions.length, notifications: db.state.notifications.length };
    await expectApiError(as(admin, () => api.admin.restrict("u_nobody", 3, "Testing a missing student")), "NOT_FOUND");
    expect({ restrictions: db.state.restrictions.length, notifications: db.state.notifications.length }).toEqual(before);
    // Whatever a failing mutation wrote is rolled back — in memory and on disk.
    const row = { id: "rollback:test", userId: "u_admin", facilityId: "f_tennis", createdAt: new Date().toISOString() };
    await expect(
      db.transaction(() => {
        db.put("favorites", row);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(db.state.favorites.some((f) => f.id === row.id)).toBe(false);
    db.close();
    db.open(path.join(dir, "test.db"));
    expect(db.state.favorites.some((f) => f.id === row.id)).toBe(false);
  });

  it("only students can be paused, and only real facilities saved as favourites", async () => {
    await expectApiError(as(admin, () => api.admin.restrict("u_admin", 3, "Pausing an administrator")), "NOT_FOUND");
    const s = await student("fav.check@badya.edu.eg");
    await expectApiError(as(s, () => api.me.toggleFavorite("f_does_not_exist")), "NOT_FOUND");
    expect(db.state.favorites.some((f) => f.userId === s.userId)).toBe(false);
  });

  it("a new facility type can't overwrite an existing one, and a facility needs a real type", async () => {
    const act = db.state.categories.find((c) => c.id === "cat_activity")!;
    await expectApiError(as(admin, () => api.admin.saveCategory({ ...act, name: "Overwritten" }, true)), "CONFLICT");
    expect(db.state.categories.find((c) => c.id === "cat_activity")!.name).toBe(act.name);
    const tpl = db.state.facilities.find((f) => f.id === "f_billiards")!;
    await expectApiError(as(admin, () => api.admin.saveFacility({ ...tpl, id: "f_orphan", name: "Orphan Table", categoryId: "cat_missing" }, true)), "VALIDATION");
    expect(db.state.facilities.some((f) => f.id === "f_orphan")).toBe(false);
  });

  it("an impossible date is refused instead of silently becoming another day", async () => {
    const s = await student("date.check@badya.edu.eg");
    for (const day of ["2026-02-30", "2026-13-45"]) await expectApiError(as(s, () => api.facilities.availability("f_tennis", day)), "VALIDATION");
  });

  it("a university ID of the wrong length is explained as such", async () => {
    const e = await expectApiError(as(device("short-id"), () => api.auth.register({ name: "Short Id", email: "short.id@badya.edu.eg", universityId: "1234", faculty: "Engineering", year: 1, level: "undergraduate", password: PASSWORD })), "VALIDATION");
    expect(e.message).toMatch(/5 to 12 digits/);
  });

  it("a request waiting for approval frees its spot for the waitlist when it's cancelled or declined", async () => {
    await withApproval(true);
    try {
      const [a, b, c] = [await student("pend.a@badya.edu.eg"), await student("pend.b@badya.edu.eg"), await student("pend.c@badya.edu.eg")];
      const [s1, s2] = await freeRun(a, "f_airhockey", 2);
      const r1 = await as(a, () => api.bookings.create({ facilityId: "f_airhockey", start: s1, participantIds: [], idempotencyKey: "p1" }));
      expect(r1.booking.status).toBe("PENDING");
      await as(b, () => api.waitlist.join("f_airhockey", s1));
      await as(a, () => api.bookings.cancel(r1.booking.id, "Plans changed"));
      expect(db.state.waitlist.find((w) => w.userId === b.userId && w.start === s1)!.status).toBe("offered");
      const r2 = await as(c, () => api.bookings.create({ facilityId: "f_airhockey", start: s2, participantIds: [], idempotencyKey: "p2" }));
      await as(a, () => api.waitlist.join("f_airhockey", s2));
      await as(admin, () => api.admin.decide(r2.booking.id, "rejected", "Reserved for a tournament"));
      expect(db.state.waitlist.find((w) => w.userId === a.userId && w.start === s2)!.status).toBe("offered");
    } finally {
      await withApproval(false);
    }
  });

  it("a request can't be approved once its session has started", async () => {
    await withApproval(true);
    try {
      const s = await student("late.approval@badya.edu.eg");
      const [slot] = await freeRun(s, "f_airhockey", 1);
      const { booking } = await as(s, () => api.bookings.create({ facilityId: "f_airhockey", start: slot, participantIds: [], idempotencyKey: "la" }));
      clock.syncTo(new Date(new Date(slot).getTime() + 60_000));
      try {
        await expectApiError(as(admin, () => api.admin.decide(booking.id, "approved")), "CONFLICT");
      } finally {
        clock.syncTo(new Date());
      }
      expect(bookingById(booking.id).status).toBe("PENDING");
    } finally {
      await withApproval(false);
    }
  });

  it("closing a facility tells everyone on its bookings and clears its waitlist", async () => {
    const [booker, mate, host, invitee, waiter] = [await student("cl.booker@badya.edu.eg"), await student("cl.mate@badya.edu.eg"), await student("cl.host@badya.edu.eg"), await student("cl.invitee@badya.edu.eg"), await student("cl.waiter@badya.edu.eg")];
    const [slot] = await freeRun(booker, "f_padel", 1);
    const g1 = await as(booker, () => api.bookings.create({ facilityId: "f_padel", start: slot, participantIds: [mate.userId], idempotencyKey: "cl1" }));
    await as(mate, () => api.bookings.respond(g1.booking.id, "accept"));
    await as(host, () => api.bookings.create({ facilityId: "f_padel", start: slot, participantIds: [invitee.userId], idempotencyKey: "cl2" }));
    await as(waiter, () => api.waitlist.join("f_padel", slot));
    const before = [mate, invitee, waiter].map((s) => notesFor(s).length);
    try {
      await as(admin, () => api.admin.setFacilityStatus("f_padel", "inactive", "Resurfacing"));
      expect([mate, invitee, waiter].map((s, i) => notesFor(s).length - before[i])).toEqual([1, 1, 1]);
      expect(db.state.waitlist.find((w) => w.userId === waiter.userId)!.status).toBe("cancelled");
      expect((await as(waiter, () => api.me.standing())).campus.waitlists).toBe(0);
    } finally {
      await as(admin, () => api.admin.setFacilityStatus("f_padel", "active"));
    }
  });

  it("a facility whose type is switched off can't be booked from a saved link", async () => {
    const s = await student("hidden.type@badya.edu.eg");
    const [slot] = await freeRun(s, "f_pingpong", 1);
    const act = db.state.categories.find((c) => c.id === "cat_activity")!;
    await as(admin, () => api.admin.saveCategory({ ...act, active: false }, false));
    try {
      const e = await expectApiError(as(s, () => api.bookings.create({ facilityId: "f_pingpong", start: slot, participantIds: [], idempotencyKey: "hidden" })), "RULE_VIOLATION");
      expect(e.details!.map((d) => d.code)).toContain("facility_inactive");
      expect((await as(s, () => api.facilities.get("f_pingpong"))).today.bookable).toBe(0);
    } finally {
      await as(admin, () => api.admin.saveCategory(act, false));
    }
  });

  it("a temporary password has to be changed before anything else works — on the server too", async () => {
    const saved = await as(admin, () => api.admin.saveMember({ name: "Temp Staff", email: "temp.staff@badya.edu.eg", title: "Supervisor", role: "staff", assignedFacilityIds: ["f_tennis"], status: "active" }));
    const c = device("temp-staff");
    expect((await as(c, () => api.auth.signIn("temp.staff@badya.edu.eg", saved.tempPassword!))).status).toBe("signed_in");
    const me = { ...c, userId: saved.id, sessionId: sessionOf(c) };
    await expectApiError(as(me, () => dispatch("staff", "overview", [])), "FORBIDDEN");
    await as(me, () => dispatch("auth", "changePassword", [saved.tempPassword!, "a brand new staff one"]));
    await as(me, () => dispatch("staff", "overview", []));
  });

  it("a waitlist offer is never held past the moment booking closes", async () => {
    const [holder, mate, waiter] = [await student("cap.holder@badya.edu.eg"), await student("cap.mate@badya.edu.eg"), await student("cap.waiter@badya.edu.eg")];
    const [slot] = await freeRun(holder, "f_tennis", 1);
    const { booking } = await as(holder, () => api.bookings.create({ facilityId: "f_tennis", start: slot, participantIds: [mate.userId], idempotencyKey: "cap" }));
    await as(waiter, () => api.waitlist.join("f_tennis", slot));
    // 40 minutes before: a 30-minute hold would run past 20 minutes before the start, when booking closes.
    clock.syncTo(new Date(new Date(slot).getTime() - 40 * 60_000));
    try {
      await as(holder, () => api.bookings.cancel(booking.id, "Plans changed"));
    } finally {
      clock.syncTo(new Date());
    }
    const offer = db.state.waitlist.find((w) => w.userId === waiter.userId && w.start === slot)!;
    expect(offer.status).toBe("offered");
    expect(new Date(offer.offerExpiresAt!).getTime()).toBe(new Date(slot).getTime() - 20 * 60_000);
  });

  it("a paused student is told about the pause, not that someone beat them to it", async () => {
    const [taker, paused] = [await student("full.taker@badya.edu.eg"), await student("full.paused@badya.edu.eg")];
    const [slot] = await freeRun(taker, "f_billiards", 1);
    await as(taker, () => api.bookings.create({ facilityId: "f_billiards", start: slot, participantIds: [], idempotencyKey: "ft" }));
    await as(admin, () => api.admin.restrict(paused.userId, 3, "Audit test pause"));
    const e = await expectApiError(as(paused, () => api.bookings.create({ facilityId: "f_billiards", start: slot, participantIds: [], idempotencyKey: "fp" })), "RULE_VIOLATION");
    expect(e.details!.map((d) => d.code)).toEqual(expect.arrayContaining(["restricted", "full"]));
    expect(e.message).toMatch(/paused/);
  });

  it("waiving the strike that caused an automatic pause lifts it; a pause set by hand stays", async () => {
    const s = await student("waive.lift@badya.edu.eg");
    const ids = ["BK-AUDIT-1", "BK-AUDIT-2", "BK-AUDIT-3"];
    await db.transaction(() => {
      ids.forEach((id, i) => {
        const start = addDays(new Date(), -1);
        start.setHours(10 + i, 0, 0, 0);
        const end = new Date(start.getTime() + 30 * 60_000).toISOString();
        db.put("bookings", { id, facilityId: "f_billiards", userId: s.userId, unitIndex: 0, start: start.toISOString(), end, status: "NO_SHOW", participants: [], source: "student", createdAt: start.toISOString(), updatedAt: end, version: 2, noShow: { at: end, byUserId: "system", auto: true } });
      });
      applyLadder(s.userId, "system");
    });
    const pause = () => db.state.restrictions.filter((r) => r.userId === s.userId && !r.lifted);
    expect(pause().map((r) => r.source)).toEqual(["auto"]);
    await as(admin, () => api.admin.waiveStrike(ids[0], "Doctor's note"));
    expect(pause()).toEqual([]);
    expect((await as(s, () => api.me.standing())).standing.level).toBe("final_warning");
    await as(admin, () => api.admin.restrict(s.userId, 5, "Audit test manual pause"));
    await as(admin, () => api.admin.waiveStrike(ids[1], "Doctor's note"));
    expect(pause().map((r) => r.source)).toEqual(["admin"]);
    await expectApiError(as(admin, () => api.admin.waiveStrike(ids[1], "Again")), "CONFLICT");
  });

  it("invitations can't be used to flood someone's phone", async () => {
    const [host, target] = [await student("spam.host@badya.edu.eg"), await student("spam.target@badya.edu.eg")];
    const [slot] = await freeRun(host, "f_tennis", 1);
    const { booking } = await as(host, () => api.bookings.create({ facilityId: "f_tennis", start: slot, participantIds: [target.userId], idempotencyKey: "spam" }));
    const e = await (async () => {
      for (let i = 0; i < 15; i++) {
        await as(host, () => api.bookings.uninvite(booking.id, target.userId));
        await as(host, () => api.bookings.invite(booking.id, [target.userId]));
      }
    })().then(() => null, (x) => x);
    expect((e as InstanceType<typeof ApiError> | null)?.code).toBe("RATE_LIMITED");
    expect(notesFor(target).length).toBeLessThanOrEqual(21);
  });

  it("scheduled maintenance cancels the sessions inside it, tells everyone on them and clears their waitlist", async () => {
    const [booker, invitee, waiter] = [await student("mt.booker@badya.edu.eg"), await student("mt.invitee@badya.edu.eg"), await student("mt.waiter@badya.edu.eg")];
    const [slot] = await freeRun(booker, "f_tennis", 1);
    const { booking } = await as(booker, () => api.bookings.create({ facilityId: "f_tennis", start: slot, participantIds: [invitee.userId], idempotencyKey: "mt" }));
    await as(waiter, () => api.waitlist.join("f_tennis", slot));
    const end = new Date(new Date(slot).getTime() + 30 * 60_000).toISOString();
    const m = await as(admin, () => api.admin.createMaintenance({ facilityId: "f_tennis", start: slot, end, reason: "Net replacement" }));
    expect(m.affectedBookingIds).toEqual([booking.id]);
    expect(bookingById(booking.id)).toMatchObject({ status: "CANCELLED", cancellation: { penalty: false } });
    expect(notesFor(booker).some((n) => n.type === "maintenance")).toBe(true);
    expect(notesFor(invitee).some((n) => n.type === "maintenance")).toBe(true);
    expect(notesFor(waiter).some((n) => n.type === "waitlist_expired")).toBe(true);
    expect(db.state.waitlist.find((w) => w.userId === waiter.userId)!.status).toBe("cancelled");
    await as(admin, () => api.admin.cancelMaintenance(m.id));
    const av = await as(booker, () => api.facilities.availability("f_tennis", format(new Date(slot), "yyyy-MM-dd")));
    expect(av.slots.find((x) => x.session.start === slot)!.status).not.toBe("maintenance");
  });

  it("staff report issues at their own facility, administrators hear about it, and it can be resolved", async () => {
    const saved = await as(admin, () => api.admin.saveMember({ name: "Court Keeper", email: "court.keeper@badya.edu.eg", title: "Courts supervisor", role: "staff", assignedFacilityIds: ["f_tennis"], status: "active" }));
    const c = device("court-keeper");
    await as(c, () => api.auth.signIn("court.keeper@badya.edu.eg", saved.tempPassword!));
    const me = { ...c, setCookies: [], userId: saved.id, sessionId: sessionOf(c) };
    await as(me, () => api.auth.changePassword(saved.tempPassword!, "a keeper of courts"));
    const before = db.state.notifications.filter((n) => n.userId === "u_admin").length;
    const issue = await as(me, () => api.staff.reportIssue({ facilityId: "f_tennis", category: "equipment", severity: "high", description: "The net is torn near the left post." }));
    expect(db.state.notifications.filter((n) => n.userId === "u_admin").length).toBe(before + 1);
    await expectApiError(as(me, () => api.staff.reportIssue({ facilityId: "f_padel", category: "equipment", severity: "low", description: "Not my court but reporting anyway." })), "FORBIDDEN");
    expect((await as(me, () => api.staff.updateIssue(issue.id, "resolved"))).status).toBe("resolved");
  });

  it("changing opening hours under upcoming bookings asks first, then cancels them and tells the students", async () => {
    const s = await student("hours.change@badya.edu.eg");
    const [slot] = await freeRun(s, "f_billiards", 1);
    const { booking } = await as(s, () => api.bookings.create({ facilityId: "f_billiards", start: slot, participantIds: [], idempotencyKey: "hours" }));
    const original = structuredClone(db.state.facilities.find((f) => f.id === "f_billiards")!);
    const day = new Date(slot).getDay();
    const closedThatDay = { ...original, schedule: original.schedule.map((h, i) => (i === day ? null : h)) };
    const e = await expectApiError(as(admin, () => api.admin.saveFacility(closedThatDay, false)), "CONFLICT");
    expect((e.data as { affected: { id: string }[] }).affected.map((b) => b.id)).toContain(booking.id);
    expect(db.state.facilities.find((f) => f.id === "f_billiards")!.schedule[day]).not.toBeNull();
    try {
      await as(admin, () => api.admin.saveFacility(closedThatDay, false, true));
      expect(bookingById(booking.id)).toMatchObject({ status: "CANCELLED", cancellation: { penalty: false } });
      expect(db.state.notifications.some((n) => n.userId === s.userId && n.type === "maintenance")).toBe(true);
    } finally {
      await as(admin, () => api.admin.saveFacility(original, false));
    }
  });
});

/* ───────────── Student accounts: suspend, close, correct ───────────── */

describe("student accounts", () => {
  it("a suspended student can look and cancel but not book, wait, invite or search — not even through the API directly", async () => {
    const [s, friend] = [await student("susp@badya.edu.eg"), await student("susp.friend@badya.edu.eg")];
    const [a, b] = await freeRun(s, "f_airhockey", 2);
    const own = await as(s, () => api.bookings.create({ facilityId: "f_airhockey", start: a, participantIds: [], idempotencyKey: "susp-own" }));
    const [tennis] = await freeRun(friend, "f_tennis", 1);
    const invite = await as(friend, () => api.bookings.create({ facilityId: "f_tennis", start: tennis, participantIds: [s.userId], idempotencyKey: "susp-inv" }));
    await expectApiError(as(admin, () => api.admin.suspendStudent(s.userId, "no")), "VALIDATION");
    await as(admin, () => api.admin.suspendStudent(s.userId, "Misuse of facility"));
    expect(userBy("susp@badya.edu.eg")).toMatchObject({ status: "suspended", statusNote: { reason: "Misuse of facility" } });
    // Their own booking stays (nothing said to cancel it); the open invitation ends.
    expect(bookingById(own.booking.id).status).toBe("CONFIRMED");
    expect(bookingById(invite.booking.id).participants.find((p) => p.userId === s.userId)?.status).toBe("declined");
    await expectApiError(as(s, () => api.bookings.create({ facilityId: "f_airhockey", start: b, participantIds: [], idempotencyKey: "susp-2" })), "FORBIDDEN");
    await expectApiError(as(s, () => dispatch("bookings", "create", [{ facilityId: "f_airhockey", start: b, participantIds: [], idempotencyKey: "susp-3" }])), "FORBIDDEN");
    await expectApiError(as(s, () => api.waitlist.join("f_airhockey", b)), "FORBIDDEN");
    await expectApiError(as(s, () => api.bookings.invite(own.booking.id, [friend.userId])), "FORBIDDEN");
    await expectApiError(as(s, () => api.me.searchStudents(userBy("susp.friend@badya.edu.eg").universityId!)), "FORBIDDEN");
    const ev = await as(friend, () => api.facilities.evaluate({ facilityId: "f_tennis", start: at(2, 10), participantIds: [s.userId] }));
    expect(ev.blocking.map((x) => x.code)).toContain("participant_invalid");
    expect((await as(s, () => api.me.standing())).suspended?.reason).toBe("Misuse of facility");
    expect((await as(s, () => api.bookings.mine())).some((x) => x.id === own.booking.id)).toBe(true);
    await as(s, () => api.bookings.cancel(own.booking.id, "Can't come"));
    expect(db.state.notifications.some((n) => n.userId === s.userId && n.title.includes("suspended"))).toBe(true);
    expect(db.state.audit.some((x) => x.action === "user.suspend" && x.entityId === s.userId)).toBe(true);
    await expectApiError(as(admin, () => api.admin.suspendStudent(s.userId, "Twice over")), "CONFLICT");
    await as(admin, () => api.admin.unsuspendStudent(s.userId));
    const again = await as(s, () => api.bookings.create({ facilityId: "f_airhockey", start: b, participantIds: [], idempotencyKey: "susp-4" }));
    expect(again.booking.status).toBe("CONFIRMED");
  });

  it("suspending can also cancel the student's upcoming bookings when the office chooses to", async () => {
    const s = await student("susp.release@badya.edu.eg");
    const [slot] = await freeRun(s, "f_billiards", 1);
    const { booking } = await as(s, () => api.bookings.create({ facilityId: "f_billiards", start: slot, participantIds: [], idempotencyKey: "susp-rel" }));
    const r = await as(admin, () => api.admin.suspendStudent(s.userId, "Disciplinary decision", true));
    expect(r.cancelled).toBe(1);
    expect(bookingById(booking.id)).toMatchObject({ status: "CANCELLED", cancellation: { penalty: false } });
  });

  it("closing an account signs it out, cancels what's to come, keeps the history, and frees the ID for its real owner", async () => {
    const c = device("impostor-phone");
    const impostorId = String(nextId++);
    await signIn(c, "impostor@badya.edu.eg", impostorId);
    const u = userBy("impostor@badya.edu.eg");
    const me = { ...c, setCookies: [], userId: u.id, sessionId: sessionOf(c) } as Student;
    const [slot] = await freeRun(me, "f_billiards", 1);
    const { booking } = await as(me, () => api.bookings.create({ facilityId: "f_billiards", start: slot, participantIds: [], idempotencyKey: "closing" }));
    await as(admin, () => api.admin.deactivateStudent(u.id, "Registered by someone else"));
    expect(resolveSession(me.sessionId!, c.deviceId).userId).toBeNull();
    expect(bookingById(booking.id).status).toBe("CANCELLED");
    expect(db.state.users.some((x) => x.id === u.id)).toBe(true);
    await expectApiError(as({ ...c, setCookies: [] }, () => api.auth.signIn("impostor@badya.edu.eg", PASSWORD)), "FORBIDDEN");
    // Closed accounts are listed only when asked for.
    expect((await as(admin, () => api.admin.students({ q: impostorId }))).rows).toHaveLength(0);
    expect((await as(admin, () => api.admin.students({ q: impostorId, level: "deactivated" }))).rows).toHaveLength(1);
    // The real student can now register with their own ID…
    const real = await as(device("real-owner-phone"), () => api.auth.register({ name: "Real Owner", email: "real.owner2@badya.edu.eg", universityId: impostorId, faculty: "Engineering", year: 1, level: "undergraduate", password: PASSWORD }));
    expect(real.status).toBe("signed_in");
    // …and the impostor account can't be reopened over it.
    await expectApiError(as(admin, () => api.admin.reactivateStudent(u.id)), "CONFLICT");
    await expectApiError(as(admin, () => api.admin.deactivateStudent(u.id, "Again please")), "CONFLICT");
  });

  it("a closed account can be reopened when nobody else uses its email or ID", async () => {
    const s = await student("reopen@badya.edu.eg");
    await as(admin, () => api.admin.deactivateStudent(s.userId, "Left the university"));
    await as(admin, () => api.admin.reactivateStudent(s.userId, "Came back"));
    expect(userBy("reopen@badya.edu.eg")).toMatchObject({ status: "active" });
    expect((await as({ ...device("reopen-phone-2"), setCookies: [] }, () => api.auth.signIn("reopen@badya.edu.eg", PASSWORD))).status).toBe("signed_in");
  });

  it("faculty and year are corrected by the office, checked on the server, and the student is told", async () => {
    const s = await student("fix.me@badya.edu.eg");
    await expectApiError(as(admin, () => api.admin.updateStudent(s.userId, { faculty: "Astrology" })), "VALIDATION");
    await expectApiError(as(admin, () => dispatch("admin", "updateStudent", [s.userId, { year: 9 }])), "VALIDATION");
    await expectApiError(as(admin, () => dispatch("admin", "updateStudent", [s.userId, { name: "New Name" }])), "VALIDATION");
    await expectApiError(as(admin, () => api.admin.updateStudent(s.userId, { faculty: "Engineering", year: 2 })), "VALIDATION");
    await as(admin, () => api.admin.updateStudent(s.userId, { faculty: "Medicine", year: 5 }));
    expect(userBy("fix.me@badya.edu.eg")).toMatchObject({ faculty: "Medicine", year: 5, overrides: { faculty: { byUserId: "u_admin" }, year: { byUserId: "u_admin" } } });
    expect(db.state.notifications.some((n) => n.userId === s.userId && n.body.includes("Medicine"))).toBe(true);
    const keeper = await teamMember("u_fix_staff", "staff", ["f_tennis"]);
    for (const who of [s, keeper]) {
      await expectApiError(as(who, () => api.admin.updateStudent(s.userId, { year: 1 })), "FORBIDDEN");
      await expectApiError(as(who, () => api.admin.suspendStudent(s.userId, "Not allowed to")), "FORBIDDEN");
      await expectApiError(as(who, () => api.admin.deactivateStudent(s.userId, "Not allowed to")), "FORBIDDEN");
    }
    await expectApiError(as(admin, () => api.admin.updateStudent("u_admin", { year: 1 })), "NOT_FOUND");
  });
});

/* ───────────── Retiring facilities and facility types ───────────── */

describe("retiring facilities", () => {
  const blank = (id: string, categoryId = "cat_activity") => ({ ...structuredClone(db.state.facilities.find((f) => f.id === "f_billiards")!), id, name: `Spare ${id}`, categoryId, policy: {} });

  it("an archived facility disappears for students and staff, keeps its history, and comes back as it was", async () => {
    const s = await student("archive.watch@badya.edu.eg");
    const keeper = await teamMember("u_archive_staff", "staff", ["f_pingpong"]);
    const [slot] = await freeRun(s, "f_pingpong", 1);
    const { booking } = await as(s, () => api.bookings.create({ facilityId: "f_pingpong", start: slot, participantIds: [], idempotencyKey: "archive" }));
    await as(s, () => api.me.toggleFavorite("f_pingpong"));
    await expectApiError(as(s, () => api.admin.archiveFacility("f_pingpong")), "FORBIDDEN");
    await expectApiError(as(keeper, () => api.admin.archiveFacility("f_pingpong")), "FORBIDDEN");
    // Upcoming bookings are listed first; nothing changes until the office confirms.
    const e = await expectApiError(as(admin, () => api.admin.archiveFacility("f_pingpong", "Table removed")), "CONFLICT");
    expect((e.data as { affected: { id: string }[] }).affected.map((b) => b.id)).toContain(booking.id);
    expect(db.state.facilities.find((f) => f.id === "f_pingpong")!.archived).toBeUndefined();
    try {
      const r = await as(admin, () => api.admin.archiveFacility("f_pingpong", "Table removed", true));
      expect(r.cancelled).toBeGreaterThanOrEqual(1);
      expect(bookingById(booking.id)).toMatchObject({ status: "CANCELLED", cancellation: { penalty: false } });
      expect(db.state.notifications.some((n) => n.userId === s.userId && n.type === "maintenance" && n.link === "/bookings")).toBe(true);
      // Students: gone from lists and links; nothing can be booked.
      expect((await as(s, () => api.facilities.list())).some((x) => x.facility.id === "f_pingpong")).toBe(false);
      await expectApiError(as(s, () => api.facilities.get("f_pingpong")), "NOT_FOUND");
      await expectApiError(as(s, () => api.facilities.availability("f_pingpong", format(new Date(slot), "yyyy-MM-dd"))), "NOT_FOUND");
      await expect(as(s, () => api.bookings.create({ facilityId: "f_pingpong", start: slot, participantIds: [], idempotencyKey: "archive-2" }))).rejects.toBeInstanceOf(ApiError);
      expect((await as(s, () => api.me.favorites())).some((f) => f.facility.id === "f_pingpong")).toBe(false);
      await as(s, () => api.me.toggleFavorite("f_pingpong"));
      await expectApiError(as(s, () => api.me.toggleFavorite("f_pingpong")), "NOT_FOUND");
      // Staff: not on their day any more. The office still sees it, with its history.
      expect((await as(keeper, () => api.staff.overview())).facilities.map((f) => f.facility.id)).not.toContain("f_pingpong");
      const row = (await as(admin, () => api.admin.facilities())).find((x) => x.facility.id === "f_pingpong")!;
      expect(row).toMatchObject({ hasHistory: true, facility: { status: "inactive", archived: { reason: "Table removed", previousStatus: "active" } } });
      expect((await as(s, () => api.bookings.mine())).some((x) => x.id === booking.id)).toBe(true);
      // An edit sent from an old copy can't un-archive it.
      await as(admin, () => api.admin.saveFacility({ ...db.state.facilities.find((f) => f.id === "f_pingpong")!, archived: undefined, status: "active" }, false));
      expect(db.state.facilities.find((f) => f.id === "f_pingpong")!.archived).toBeDefined();
      // Something with history is never deleted.
      await expectApiError(as(admin, () => api.admin.deleteFacility("f_pingpong")), "CONFLICT");
    } finally {
      await as(admin, () => api.admin.restoreFacility("f_pingpong"));
    }
    expect(db.state.facilities.find((f) => f.id === "f_pingpong")).toMatchObject({ status: "active", archived: undefined });
    expect((await as(s, () => api.facilities.list())).some((x) => x.facility.id === "f_pingpong")).toBe(true);
    await expectApiError(as(admin, () => api.admin.restoreFacility("f_pingpong")), "CONFLICT");
  });

  it("a facility nothing refers to can be deleted for good", async () => {
    await as(admin, () => api.admin.saveFacility(blank("f_mistake"), true));
    const s = await student("mistake.fav@badya.edu.eg");
    await as(s, () => api.me.toggleFavorite("f_mistake"));
    const keeper = await teamMember("u_mistake_staff", "staff", ["f_mistake", "f_tennis"]);
    await expectApiError(as(keeper, () => api.admin.deleteFacility("f_mistake")), "FORBIDDEN");
    await as(admin, () => api.admin.deleteFacility("f_mistake"));
    expect(db.state.facilities.some((f) => f.id === "f_mistake")).toBe(false);
    expect(db.state.favorites.some((f) => f.facilityId === "f_mistake")).toBe(false);
    expect(db.state.users.find((u) => u.id === keeper.userId)!.assignedFacilityIds).toEqual(["f_tennis"]);
    expect(db.state.audit.some((a) => a.action === "facility.delete" && a.entityId === "f_mistake")).toBe(true);
  });

  it("a facility type retires only once its facilities have, and archived types take no new facilities", async () => {
    await as(admin, () => api.admin.saveCategory({ ...structuredClone(db.state.categories.find((c) => c.id === "cat_activity")!), id: "cat_spare", name: "Spare Type", sortOrder: 99 }, true));
    await as(admin, () => api.admin.saveFacility(blank("f_spare_one", "cat_spare"), true));
    const s = await student("type.watch@badya.edu.eg");
    await expectApiError(as(admin, () => api.admin.archiveCategory("cat_spare")), "CONFLICT");
    await expectApiError(as(s, () => api.admin.archiveCategory("cat_spare")), "FORBIDDEN");
    await as(admin, () => api.admin.archiveFacility("f_spare_one"));
    await as(admin, () => api.admin.archiveCategory("cat_spare"));
    expect((await as(s, () => api.facilities.categories())).some((c) => c.id === "cat_spare")).toBe(false);
    expect((await as(admin, () => api.admin.policies())).categories.some((c) => c.id === "cat_spare")).toBe(false);
    expect((await as(admin, () => api.admin.categories())).find((x) => x.category.id === "cat_spare")).toMatchObject({ facilities: 0, archivedFacilities: 1 });
    await expectApiError(as(admin, () => api.admin.saveFacility(blank("f_spare_two", "cat_spare"), true)), "VALIDATION");
    await expectApiError(as(admin, () => api.admin.restoreFacility("f_spare_one")), "CONFLICT");
    // A type an archived facility still belongs to is kept for its history.
    await expectApiError(as(admin, () => api.admin.deleteCategory("cat_spare")), "CONFLICT");
    await as(admin, () => api.admin.restoreCategory("cat_spare"));
    await as(admin, () => api.admin.restoreFacility("f_spare_one"));
    expect(db.state.facilities.find((f) => f.id === "f_spare_one")!.status).toBe("active");
    await as(admin, () => api.admin.deleteFacility("f_spare_one"));
    await as(admin, () => api.admin.deleteCategory("cat_spare"));
    expect(db.state.categories.some((c) => c.id === "cat_spare")).toBe(false);
  });

  it("the office's facility catalogue isn't open to students or staff", async () => {
    const s = await student("catalogue.peek@badya.edu.eg");
    const keeper = await teamMember("u_catalogue_staff", "staff", ["f_tennis"]);
    await expectApiError(as(s, () => api.admin.facilities()), "FORBIDDEN");
    await expectApiError(as(keeper, () => api.admin.facilities()), "FORBIDDEN");
    await expectApiError(as(keeper, () => api.admin.categories()), "FORBIDDEN");
    expect((await as(admin, () => api.admin.facilities())).length).toBeGreaterThan(5);
  });
});

/* ───────────── Checking in ───────────── */

describe("privacy", () => {
  it("students see other students' university IDs masked; staff and administrators see them in full", async () => {
    const [host, mate] = [await student("mask.host@badya.edu.eg"), await student("mask.mate@badya.edu.eg")];
    const [hostId, mateId] = [userBy("mask.host@badya.edu.eg").universityId!, userBy("mask.mate@badya.edu.eg").universityId!];
    const [slot] = await freeRun(host, "f_tennis", 1);
    const { booking } = await as(host, () => api.bookings.create({ facilityId: "f_tennis", start: slot, participantIds: [mate.userId], idempotencyKey: "mask" }));
    expect(booking.booker.universityId).toBe(hostId);
    expect(booking.team[0].user.universityId).toBe(`•••${mateId.slice(-3)}`);
    const seenByMate = await as(mate, () => api.bookings.get(booking.id));
    expect(seenByMate.booker.universityId).toBe(`•••${hostId.slice(-3)}`);
    expect(JSON.stringify(seenByMate)).not.toContain(hostId);
    const seenByOffice = (await as(admin, () => api.admin.student(host.userId))).bookings.find((b) => b.id === booking.id)!;
    expect([seenByOffice.booker.universityId, seenByOffice.team[0].user.universityId]).toEqual([hostId, mateId]);
  });
});

describe("checking in", () => {
  /** A confirmed billiards booking tomorrow, with the clock moved to just before it. */
  async function readyToCheckIn(email: string) {
    const s = await student(email);
    const [slot] = await freeRun(s, "f_billiards", 1);
    const { booking } = await as(s, () => api.bookings.create({ facilityId: "f_billiards", start: slot, participantIds: [], idempotencyKey: `ci-${email}` }));
    return { s, slot, booking };
  }
  const nearly = (slot: string) => clock.syncTo(new Date(new Date(slot).getTime() - 5 * 60_000));

  it("a live code checks the student in once; an old, edited, copied or foreign code doesn't", async () => {
    const keeper = await teamMember("u_scan_staff", "staff", ["f_billiards"]);
    const { s, slot, booking } = await readyToCheckIn("scan.me@badya.edu.eg");
    nearly(slot);
    try {
      const { token } = await as(s, () => api.bookings.qr(booking.id));
      const old = await signToken({ b: booking.id, u: s.userId, f: "f_billiards", s: slot, w: windowOf(clock.now().getTime(), db.state.settings.qrRotationSeconds) - 3 });
      expect((await as(keeper, () => api.staff.scan(old, "f_billiards"))).title).toMatch(/expired/);
      expect((await as(keeper, () => api.staff.scan(tamper(token, { u: "u_admin" }), "f_billiards"))).title).toMatch(/Invalid/);
      expect((await as(keeper, () => api.staff.scan("not a ticket", "f_billiards"))).ok).toBe(false);
      await expectApiError(as(keeper, () => api.staff.scan(token, "f_tennis")), "FORBIDDEN");
      await expectApiError(as(s, () => api.staff.scan(token, "f_billiards")), "FORBIDDEN");
      const ok = await as(keeper, () => api.staff.scan(token, "f_billiards"));
      expect(ok).toMatchObject({ ok: true, student: { id: s.userId } });
      expect(bookingById(booking.id)).toMatchObject({ status: "CHECKED_IN", checkIn: { method: "qr", byUserId: keeper.userId } });
      const again = await as(keeper, () => api.staff.scan(token, "f_billiards"));
      expect(again).toMatchObject({ ok: false, alreadyCheckedIn: true });
    } finally {
      clock.syncTo(new Date());
    }
  });

  it("without a code, the booking reference finds the booking but checking in waits for the student card", async () => {
    const keeper = await teamMember("u_lookup_staff", "staff", ["f_billiards"]);
    const other = await teamMember("u_lookup_other", "staff", ["f_tennis"]);
    const { s, slot, booking } = await readyToCheckIn("lookup.me@badya.edu.eg");
    nearly(slot);
    try {
      const found = await as(keeper, () => api.staff.lookup(` ${booking.id.toLowerCase()} `, "f_billiards"));
      expect(found).toMatchObject({ ok: false, verify: true, student: { id: s.userId }, booking: { id: booking.id } });
      expect(bookingById(booking.id).status).toBe("CONFIRMED");
      // Only today's bookings at the chosen facility — no browsing other records.
      expect((await as(keeper, () => api.staff.lookup("BK-2026-999999", "f_billiards"))).title).toMatch(/not found/);
      await expectApiError(as(other, () => api.staff.lookup(booking.id, "f_billiards")), "FORBIDDEN");
      const elsewhere = await as(other, () => api.staff.lookup(booking.id, "f_tennis"));
      expect(elsewhere.ok).toBe(false);
      expect(elsewhere.verify).toBeUndefined();
      expect(elsewhere.student).toBeUndefined();
      await expectApiError(as(s, () => api.staff.lookup(booking.id, "f_billiards")), "FORBIDDEN");
      await as(keeper, () => api.staff.checkIn(booking.id));
      expect(bookingById(booking.id)).toMatchObject({ status: "CHECKED_IN", checkIn: { method: "manual" } });
      expect(await as(keeper, () => api.staff.lookup(booking.id, "f_billiards"))).toMatchObject({ alreadyCheckedIn: true });
    } finally {
      clock.syncTo(new Date());
    }
  });
});
