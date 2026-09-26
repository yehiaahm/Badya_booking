import { AR, type PluralForms } from "./ar";
import { currentLanguage } from "./lang";

export { L, N, arCount, count, currentLanguage, setLanguageSource, tx, withLanguage, word } from "./lang";

/**
 * Translate interface text. The English text is the key; Arabic comes from
 * `ar.ts`. Missing translations fall back to English (and are listed in
 * development so they can be added).
 *
 *   t("Book now")
 *   t("Opens at {time}", { time: "10:00" })
 */
export type Vars = Record<string, string | number | null | undefined>;

export function t(en: string, vars?: Vars): string {
  let s = en;
  if (currentLanguage() === "ar") {
    const v = AR[en];
    if (typeof v === "string") s = v;
    else report(en);
  }
  return vars ? fill(s, vars) : s;
}

/**
 * Translate a counted phrase. `other` is the dictionary key; Arabic entries
 * give the forms for 1, 2, 3–10 and 11+.
 *
 *   tn(n, "{n} session left", "{n} sessions left")
 */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  let s = n === 1 ? one : other;
  if (currentLanguage() === "ar") {
    const v = AR[other];
    if (v && typeof v === "object") s = pick(v, n);
    else if (typeof v === "string") s = v;
    else report(other);
  }
  return fill(s, { n, ...vars });
}

const rules = typeof Intl !== "undefined" ? new Intl.PluralRules("ar") : null;
function pick(forms: PluralForms, n: number): string {
  const cat = (rules?.select(n) ?? "other") as keyof PluralForms;
  return forms[cat] ?? forms.other;
}

const fill = (s: string, vars: Vars) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? "") : m));

/** Development aid: every untranslated string seen while using the app in Arabic. */
const missing = new Set<string>();
function report(key: string) {
  if (missing.has(key)) return;
  missing.add(key);
  if (typeof window !== "undefined") (window as unknown as { __missingArabic: string[] }).__missingArabic = [...missing];
}

/** Stored text that may be one of our own defaults (e.g. a system reason): translate it if we can, otherwise show it as written. */
export function tStored(s: string | undefined): string {
  if (!s || currentLanguage() !== "ar") return s ?? "";
  const v = AR[s];
  if (typeof v === "string") return v;
  const m = /^(\d+) missed sessions in (\d+) days$/.exec(s);
  return m ? `${m[1]} مواعيد فائتة خلال ${m[2]} يومًا` : s;
}
