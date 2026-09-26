import { create } from "zustand";
import type { SessionUser } from "@/api";
import type { Permission } from "@/domain/types";

interface SessionState {
  user: SessionUser | null;
  ready: boolean;
  /** Shown on the sign-in screen after an expired session. */
  notice: string | null;
  setUser: (u: SessionUser | null) => void;
  setReady: () => void;
  expire: (message: string) => void;
  clearNotice: () => void;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  ready: false,
  notice: null,
  setUser: (user) => set({ user, notice: null }),
  setReady: () => set({ ready: true }),
  expire: (notice) => set({ user: null, notice }),
  clearNotice: () => set({ notice: null }),
}));

export const useCan = (perm: Permission) => useSession((s) => !!s.user?.permissions.includes(perm));

export function homeFor(role: SessionUser["role"] | undefined): string {
  if (role === "staff") return "/staff";
  if (role === "admin" || role === "super_admin") return "/admin";
  return "/home";
}

/* ───────────── Theme ───────────── */

export type ThemePref = "light" | "dark" | "system";

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute("content", dark ? "#0a111b" : "#f6f2ec");
}

interface ThemeState {
  pref: ThemePref;
  set: (p: ThemePref) => void;
}

const initial = (() => {
  try {
    return (localStorage.getItem("bs-theme") as ThemePref) || "system";
  } catch {
    return "system" as ThemePref;
  }
})();

export const useTheme = create<ThemeState>((set) => ({
  pref: initial,
  set: (pref) => {
    try {
      localStorage.setItem("bs-theme", pref);
    } catch {
      /* ignore */
    }
    apply(pref);
    set({ pref });
  },
}));

if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => useTheme.getState().pref === "system" && apply("system"));
}
