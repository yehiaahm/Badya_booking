import { create } from "zustand";
import type { Language } from "@/domain/types";
import { api } from "@/api";
import { setLanguageSource } from "./lang";

/**
 * The interface language in the browser. Remembered on this device, saved to
 * the student's profile when signed in, and applied to <html lang dir>.
 */

const KEY = "bs-lang";

function initial(): Language {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ar" || saved === "en") return saved;
  } catch {
    /* private mode */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

function apply(lang: Language) {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === "ar" ? "rtl" : "ltr";
}

export const useLanguage = create<{ lang: Language; set: (l: Language) => void }>((set) => ({
  lang: initial(),
  set: (lang) => {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* private mode */
    }
    apply(lang);
    set({ lang });
  },
}));

setLanguageSource(() => useLanguage.getState().lang);
apply(useLanguage.getState().lang);

export const isRtl = () => useLanguage.getState().lang === "ar";

/** Change language from a menu or toggle — and remember it on the signed-in account. */
export function chooseLanguage(lang: Language, signedIn: boolean) {
  if (lang === useLanguage.getState().lang) return;
  useLanguage.getState().set(lang);
  if (signedIn) api.me.updatePreferences({ language: lang }).catch(() => undefined);
}

/** After sign-in: follow the language saved on the account, if any. */
export function adoptAccountLanguage(saved: Language | undefined) {
  if (saved && saved !== useLanguage.getState().lang) useLanguage.getState().set(saved);
}
