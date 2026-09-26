/**
 * Signed, rotating QR tokens.
 *
 * token = base64url(payload) + "." + base64url(HMAC-SHA256(secret, payload))[0..22]
 * payload = { b: bookingId, u: userId, f: facilityId, s: start, w: rotation window }
 *
 * The window number changes every `qrRotationSeconds`, so a screenshot shared
 * with a friend stops working within a minute. The secret lives only on the
 * server; the app fetches a fresh token from the API each window.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");
const fromB64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");

async function hmac(data: string): Promise<string> {
  return createHmac("sha256", config.qrSecret).update(data).digest("base64url").slice(0, 22);
}

export interface QrPayload {
  b: string;
  u: string;
  f: string;
  s: string;
  w: number;
}

export const windowOf = (ms: number, rotationSeconds: number) => Math.floor(ms / (rotationSeconds * 1000));

export async function signToken(p: QrPayload): Promise<string> {
  const body = b64url(JSON.stringify(p));
  return `${body}.${await hmac(body)}`;
}

export async function verifyToken(token: string): Promise<{ valid: boolean; payload?: QrPayload }> {
  const [body, sig] = token.trim().split(".");
  if (!body || !sig) return { valid: false };
  let payload: QrPayload | undefined;
  try {
    payload = JSON.parse(fromB64url(body)) as QrPayload;
  } catch {
    return { valid: false };
  }
  const expected = Buffer.from(await hmac(body));
  const given = Buffer.from(sig);
  return { valid: expected.length === given.length && timingSafeEqual(expected, given), payload };
}

/** Change one field of a token without re-signing — used to demo tamper detection. */
export function tamper(token: string, patch: Partial<QrPayload>): string {
  const [body, sig] = token.split(".");
  const p = { ...(JSON.parse(fromB64url(body)) as QrPayload), ...patch };
  return `${b64url(JSON.stringify(p))}.${sig}`;
}
