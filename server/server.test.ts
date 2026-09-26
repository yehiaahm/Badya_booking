import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { addDays, format } from "date-fns";
import { beforeAll, describe, expect, it } from "vitest";

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
/** Sign in with the password; creates a student account the first time. */
async function signIn(c: Ctx, email: string, universityId = String(nextId++), password = PASSWORD) {
  if (!db.state.users.some((u) => u.email === email)) {
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

describe("accounts and passwords", () => {
  it("only accepts university addresses, real IDs and long enough passwords", async () => {
    const base = { name: "New Student", universityId: "20880001", faculty: "Engineering", year: 1, level: "undergraduate" as const, password: PASSWORD };
    await expectApiError(as(device("x1"), () => api.auth.register({ ...base, email: "someone@gmail.com" })), "VALIDATION");
    await expectApiError(as(device("x2"), () => api.auth.register({ ...base, email: "ok@badya.edu.eg", universityId: "abc" })), "VALIDATION");
    await expectApiError(as(device("x3"), () => api.auth.register({ ...base, email: "ok@badya.edu.eg", password: "short" })), "VALIDATION");
  });

  it("rejects a second account with the same university ID or email", async () => {
    await signIn(device("dup-1"), "dup1@badya.edu.eg", "20990001");
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

  it("anyone listed on a booking can take themselves off it", async () => {
    const booker = device("booker-phone");
    const friend = device("friend-phone");
    await signIn(booker, "booker@badya.edu.eg");
    await signIn(friend, "friend@badya.edu.eg");
    const b = { ...booker, userId: userBy("booker@badya.edu.eg").id };
    const f = { ...friend, userId: userBy("friend@badya.edu.eg").id };
    const start = await nextFreeSlot(b, "f_tennis");
    const { booking } = await as(b, () => api.bookings.create({ facilityId: "f_tennis", start, participantIds: [f.userId!], idempotencyKey: "leave-test" }));
    await expectApiError(as({ ...device("stranger"), userId: userBy("sara@badya.edu.eg").id }, () => api.bookings.leave(booking.id)), "NOT_FOUND");
    await as(f, () => api.bookings.leave(booking.id));
    expect(db.state.bookings.find((x) => x.id === booking.id)!.participants).toHaveLength(0);
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
