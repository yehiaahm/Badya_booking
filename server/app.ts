import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";
import type { HttpBindings } from "@hono/node-server";
import { ApiError, type ErrorCode } from "@/api/types";
import { config } from "./config";
import { requestContext, type RequestContext } from "./context";
import { COOKIE_MAX_AGE, DEVICE_COOKIE, SESSION_COOKIE, cookie, hashToken, newToken, resolveSession } from "./api/auth";
import { db, onDbChange } from "./api/db";
import { dispatch, isPublic } from "./rpc";
import { localizeError } from "./messages";

const STATUS: Record<ErrorCode, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, RULE_VIOLATION: 422, CONFLICT: 409, VALIDATION: 400, RATE_LIMITED: 429, NETWORK: 503 };
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** API calls must carry this header — browsers won't send it cross-site without CORS, which we never allow. */
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "badya-spaces";

type Env = { Bindings: HttpBindings };

/** Loopback or private-network addresses — where a reverse proxy in front of this server would connect from. */
const fromProxy = (addr: string) => /^(::1|127\.|::ffff:127\.|10\.|::ffff:10\.|192\.168\.|::ffff:192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:172\.(1[6-9]|2\d|3[01])\.|f[cd][0-9a-f]{2}:)/i.test(addr);

function clientIp(c: Context<Env>): string {
  const peer = c.env?.incoming?.socket?.remoteAddress ?? "unknown";
  // Only a proxy we sit behind may tell us the client's address — a client talking to us directly can't.
  if (config.trustProxy && fromProxy(peer)) {
    // The proxy appends the address it saw; anything before it came from the client and can be forged.
    const last = c.req.header("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean).at(-1);
    if (last) return last;
  }
  return peer;
}

/** Build the request context: device cookie (issued if missing) and session. */
/** `renew`: the app just opened — push the cookies' expiry forward so a student's phone stays signed in. */
function contextFor(c: Context<Env>, renew = false): { rc: RequestContext; sessionExpired: boolean } {
  const lang = c.req.header("x-language") === "ar" ? "ar" : "en";
  const rc: RequestContext = { ip: clientIp(c), userAgent: c.req.header("user-agent") ?? "", deviceId: null, sessionId: null, userId: null, language: lang, setCookies: [] };
  let device = getCookie(c, DEVICE_COOKIE);
  if (!device || !TOKEN.test(device)) {
    device = newToken();
    rc.setCookies.push(cookie(DEVICE_COOKIE, device, COOKIE_MAX_AGE));
  } else if (renew) {
    rc.setCookies.push(cookie(DEVICE_COOKIE, device, COOKIE_MAX_AGE));
  }
  rc.deviceId = hashToken(device);
  let sessionExpired = false;
  const session = getCookie(c, SESSION_COOKIE);
  if (session && TOKEN.test(session)) {
    const r = resolveSession(hashToken(session), rc.deviceId);
    if (r.userId) {
      rc.userId = r.userId;
      rc.sessionId = hashToken(session);
      if (renew && db.state.users.find((u) => u.id === r.userId)?.role === "student") rc.setCookies.push(cookie(SESSION_COOKIE, session, COOKIE_MAX_AGE));
    } else {
      rc.clearSession = true;
      sessionExpired = !!r.expired;
    }
  }
  return { rc, sessionExpired };
}

function applyCookies(c: Context<Env>, rc: RequestContext) {
  for (const v of rc.setCookies) c.header("Set-Cookie", v, { append: true });
  if (rc.clearSession) c.header("Set-Cookie", cookie(SESSION_COOKIE, "", 0), { append: true });
}

/** JSON.parse that drops keys which could reach Object.prototype. */
const safeParse = (s: string) => JSON.parse(s, (k, v) => (k === "__proto__" || k === "constructor" || k === "prototype" ? undefined : v));

export function createApp() {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    c.header("X-Frame-Options", "DENY");
    c.header("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
    if (config.production) {
      c.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      if (config.secureCookies) c.header("Strict-Transport-Security", "max-age=31536000");
    }
  });

  app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

  const tooLarge = (c: Context) => c.json({ error: { code: "VALIDATION", message: "That request was too large." } }, 413);
  const normalBody = bodyLimit({ maxSize: 512 * 1024, onError: tooLarge });
  // The official student list can run to tens of thousands of rows.
  const rosterBody = bodyLimit({ maxSize: 12 * 1024 * 1024, onError: tooLarge });
  app.post("/api/:ns/:method", (c, next) => (c.req.param("ns") === "admin" && ["importRoster", "previewRoster"].includes(c.req.param("method")) ? rosterBody : normalBody)(c, next), async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Server-Time", new Date().toISOString());
    if (c.req.header(CSRF_HEADER) !== CSRF_VALUE) return c.json({ error: { code: "FORBIDDEN", message: "Request blocked." } }, 403);
    const { ns, method } = c.req.param();
    const { rc, sessionExpired } = contextFor(c, ns === "auth" && method === "me");
    try {
      let args: unknown = [];
      const raw = await c.req.text();
      if (raw) args = (safeParse(raw) as { args?: unknown }).args ?? [];
      if (!rc.userId && !isPublic(ns, method)) {
        throw sessionExpired ? new ApiError("UNAUTHENTICATED", "Your session expired after a period of inactivity. Please sign in again.", undefined, { expired: true }) : new ApiError("UNAUTHENTICATED", "Please sign in to continue.");
      }
      const result = await requestContext.run(rc, () => dispatch(ns, method, args));
      applyCookies(c, rc);
      return c.json({ data: result ?? null });
    } catch (e) {
      applyCookies(c, rc);
      if (e instanceof ApiError) return c.json({ error: { code: e.code, message: localizeError(e.message, rc.language), details: e.details, data: e.data } }, STATUS[e.code] as 400);
      if (e instanceof SyntaxError) return c.json({ error: { code: "VALIDATION", message: localizeError("That request couldn’t be read.", rc.language) } }, 400);
      console.error(`[api] ${ns}.${method} failed:`, e);
      return c.json({ error: { code: "NETWORK", message: localizeError("Something went wrong on the server. Please try again.", rc.language) } }, 500);
    }
  });

  /** Live updates: tells signed-in browsers that data changed so they refetch. */
  app.get("/api/events", (c) => {
    const { rc } = contextFor(c);
    if (!rc.userId) return c.json({ error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } }, 401);
    c.header("Cache-Control", "no-store");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let pending = false;
      let closed = false;
      const send = () => {
        if (pending || closed) return;
        pending = true;
        // Coalesce bursts of writes into one message per second.
        setTimeout(() => {
          pending = false;
          if (!closed) void stream.writeSSE({ event: "change", data: String(db.rev) });
        }, 1000);
      };
      const off = onDbChange(send);
      stream.onAbort(() => {
        closed = true;
        off();
      });
      await stream.writeSSE({ event: "ready", data: String(db.rev) });
      while (!closed) {
        await stream.sleep(25_000);
        if (!closed) await stream.writeSSE({ event: "ping", data: "" });
      }
    });
  });

  app.all("/api/*", (c) => c.json({ error: { code: "NOT_FOUND", message: "Unknown request." } }, 404));

  // The built app (production). In development Vite serves it and proxies /api here.
  const dist = path.resolve("dist");
  if (existsSync(path.join(dist, "index.html"))) {
    const index = readFileSync(path.join(dist, "index.html"), "utf8");
    app.use("/assets/*", async (c, next) => {
      await next();
      // Hashed files never change, so they're cached for good — but only when they exist: a cached
      // miss would stay broken after the next deploy puts the file there.
      c.header("Cache-Control", c.res.status === 200 ? "public, max-age=31536000, immutable" : "no-store");
    });
    app.use("*", serveStatic({ root: path.relative(process.cwd(), dist) || "." }));
    // A missing file is a 404, never the app's page (which a browser would try to run as a script).
    app.get("/assets/*", (c) => c.text("Not found", 404));
    app.get("*", (c) => {
      c.header("Cache-Control", "no-cache");
      return c.html(index);
    });
  }

  return app;
}
