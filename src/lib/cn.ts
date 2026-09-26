import clsx, { type ClassValue } from "clsx";

export const cn = (...xs: ClassValue[]) => clsx(xs);

export function initials(name: string): string {
  const parts = name.replace(/^(Dr\.?|Prof\.?)\s+/i, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function uid(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();
}
