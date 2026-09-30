import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Server configuration, read once at start-up from the environment
 * (and from a `.env` file in the project root if there is one).
 */

if (existsSync(".env")) process.loadEnvFile(".env");

const env = process.env;
// All session times, reminders and check-in windows use campus time — set before any date is computed.
process.env.TZ = env.TIMEZONE || "Africa/Cairo";
const bool = (v: string | undefined, fallback: boolean) => (v === undefined || v === "" ? fallback : /^(1|true|yes|on)$/i.test(v));
const list = (v: string | undefined, fallback: string[]) =>
  v
    ? v
        .split(",")
        .map((x) => x.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean)
    : fallback;

const dataDir = path.resolve(env.DATA_DIR || "data");
mkdirSync(dataDir, { recursive: true });

/**
 * Secrets: taken from the environment when set, otherwise generated once and
 * kept in the data folder so restarts don't sign everyone out or invalidate QR codes.
 */
function secret(name: "SESSION_SECRET" | "QR_SECRET" | "ROSTER_SECRET" | "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY", make: () => Record<string, string> = () => ({ [name]: randomBytes(32).toString("base64url") })): string {
  if (env[name]) return env[name]!;
  const file = path.join(dataDir, "secrets.json");
  let saved: Record<string, string> = {};
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* first run */
  }
  if (!saved[name]) {
    saved = { ...saved, ...make() };
    writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
  }
  return saved[name];
}

/** The key pair that signs push messages (VAPID). Both halves are made together. */
function vapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = publicKey.export({ format: "jwk" });
  // Browsers want the raw uncompressed point: 0x04 ‖ x ‖ y.
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x!, "base64url"), Buffer.from(pub.y!, "base64url")]);
  return { VAPID_PUBLIC_KEY: raw.toString("base64url"), VAPID_PRIVATE_KEY: jwk.d! };
}

const publicUrl = (env.PUBLIC_URL || "http://localhost:5173").replace(/\/$/, "");
const production = env.NODE_ENV === "production" || process.argv.includes("--production");

export const config = {
  production,
  /** API_PORT wins so tools that set PORT for the web dev server don’t collide with the API. */
  port: Number(env.API_PORT || env.PORT || 3000),
  host: env.HOST || (production ? "0.0.0.0" : "127.0.0.1"),
  publicUrl,
  dataDir,
  dbFile: path.join(dataDir, "badya-spaces.db"),
  backupDir: path.join(dataDir, "backups"),
  backupKeepDays: Number(env.BACKUP_KEEP_DAYS || 14),
  timezone: env.TIMEZONE || "Africa/Cairo",
  sessionSecret: secret("SESSION_SECRET"),
  qrSecret: secret("QR_SECRET"),
  /** Keys the hash of the national-ID digits kept from the official student list (the digits themselves are never stored). */
  rosterSecret: secret("ROSTER_SECRET"),
  /** Web Push: phones check that notifications really come from this server. */
  vapid: { publicKey: secret("VAPID_PUBLIC_KEY", vapidKeys), privateKey: secret("VAPID_PRIVATE_KEY", vapidKeys) },
  /** Cookies are marked Secure when the public address is HTTPS. */
  secureCookies: bool(env.SECURE_COOKIES, publicUrl.startsWith("https://")),
  /** Behind a reverse proxy (IIS, Nginx, Caddy) — trust X-Forwarded-For for client IPs. */
  trustProxy: bool(env.TRUST_PROXY, production),
  allowedEmailDomains: list(env.ALLOWED_EMAIL_DOMAINS, ["badya.edu.eg"]),
  /** One-tap demo accounts on a production server (only ever with demo data loaded). Off unless asked for. */
  allowDemoSignIn: bool(env.ALLOW_DEMO_SIGN_IN, false),
  /** The first super admin. Without a password here, one is generated and printed once at start-up. */
  bootstrapAdmin: env.BOOTSTRAP_ADMIN_EMAIL
    ? { email: env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase(), name: env.BOOTSTRAP_ADMIN_NAME?.trim() || "Administrator", password: env.BOOTSTRAP_ADMIN_PASSWORD || undefined }
    : null,
};

export type Config = typeof config;
