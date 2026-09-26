/**
 * The single entry point the UI talks to.
 *
 * `api.namespace.method(...args)` calls the server (`POST /api/namespace/method`)
 * and returns the same DTOs as the backend functions in `server/api`, typed
 * straight from them. Components and hooks only import from "@/api".
 */
import type { Api } from "../../server/api";
import { clock } from "@/lib/time";
import { ApiError, type ErrorCode } from "./types";
// Server messages (errors, rule explanations, facility content) come back in the interface language.
import { currentLanguage, t } from "@/i18n";

type Remote<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };
export type ApiClient = { [N in keyof Api]: Remote<Api[N]> };

const url = (p: string) => new URL(p, document.baseURI).toString();

async function call(ns: string, method: string, args: unknown[]): Promise<unknown> {
  // JSON turns `undefined` into null — trailing optional arguments are simply left off.
  while (args.length && args[args.length - 1] === undefined) args = args.slice(0, -1);
  let res: Response;
  try {
    res = await fetch(url(`api/${ns}/${method}`), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "badya-spaces", "X-Language": currentLanguage() },
      body: JSON.stringify({ args }),
    });
  } catch {
    throw new ApiError("NETWORK", t("You appear to be offline. Check your connection and try again."));
  }
  const serverTime = res.headers.get("X-Server-Time");
  if (serverTime) clock.syncTo(new Date(serverTime));
  let body: { data?: unknown; error?: { code: ErrorCode; message: string; details?: ApiError["details"]; data?: unknown } };
  try {
    body = await res.json();
  } catch {
    throw new ApiError("NETWORK", res.status >= 500 ? t("The server is having trouble right now. Please try again in a moment.") : t("The server sent an unexpected response. Please try again."));
  }
  if (body.error) throw new ApiError(body.error.code, body.error.message, body.error.details, body.error.data);
  return body.data;
}

export const api = new Proxy({} as ApiClient, {
  get: (_t, ns: string) => new Proxy({}, { get: (_m, method: string) => (...args: unknown[]) => call(ns, method, args) }),
});

/**
 * Live updates: the server tells signed-in browsers when data changed.
 * Returns a function that stops listening.
 */
export function subscribeToChanges(onChange: () => void): () => void {
  let source: EventSource | null = null;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    source = new EventSource(url("api/events"), { withCredentials: true });
    source.addEventListener("change", onChange);
    source.onerror = () => {
      source?.close();
      if (!stopped) retry = setTimeout(open, 5000);
    };
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    source?.close();
  };
}

export { ApiError } from "./types";
export type * from "./types";
