import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Passwords are stored as scrypt hashes: `scrypt$N$r$p$salt$hash`.
 * Hashing runs off the main thread, so sign-ins don't hold up other requests.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

const derive = (password: string, salt: Buffer, n = N, r = R, p = P) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

const DUMMY_SALT = randomBytes(16);

/** Compare a password with a stored hash. With no hash, still does the work so timing doesn't reveal unknown accounts. */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const parts = stored?.split("$") ?? [];
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    await derive(password, DUMMY_SALT);
    return false;
  }
  const [, n, r, p, salt, hash] = parts;
  const key = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  const expected = Buffer.from(hash, "base64url");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const MIN_PASSWORD = 8;

/** Easy to read out loud and type on a phone: no 0/O, 1/l/I. */
export function temporaryPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += chars[randomInt(chars.length)];
  return s;
}
