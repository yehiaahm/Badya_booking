import { AsyncLocalStorage } from "node:async_hooks";
import type { Language } from "@/domain/types";
import { setLanguageSource } from "@/i18n/lang";

/**
 * Per-request state. Every API call runs inside `requestContext.run(...)`,
 * so backend code can ask who is calling without threading it through
 * every function signature.
 */
export interface RequestContext {
  ip: string;
  userAgent: string;
  /** Hashed device id from the device cookie (null for system jobs). */
  deviceId: string | null;
  /** Hashed session id when a valid session cookie was presented. */
  sessionId: string | null;
  userId: string | null;
  language: Language;
  /** Set-Cookie headers to add to the response. */
  setCookies: string[];
  /** When set, the response should delete the session cookie. */
  clearSession?: boolean;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

// Server-built text (errors, rule explanations, notifications) follows the caller's language.
setLanguageSource(() => requestContext.getStore()?.language ?? "en");

export function ctx(): RequestContext {
  const c = requestContext.getStore();
  if (!c) throw new Error("No request context — backend code must run inside a request or system job.");
  return c;
}

/** Context for scheduled jobs and scripts. */
export function systemContext(): RequestContext {
  return { ip: "—", userAgent: "system", deviceId: null, sessionId: null, userId: null, language: "en", setCookies: [] };
}

export const runAsSystem = <T>(fn: () => T): T => requestContext.run(systemContext(), fn);
