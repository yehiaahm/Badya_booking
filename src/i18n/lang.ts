import type { Language } from "@/domain/types";

/**
 * The language text is produced in. The browser reads it from the user's
 * choice; the server from the request (or the recipient, for notifications).
 * Kept free of React so both sides can use it.
 */

let source: () => Language = () => "en";
let override: Language | null = null;

export const currentLanguage = (): Language => override ?? source();

export function setLanguageSource(fn: () => Language) {
  source = fn;
}

/** Produce text in a specific language — e.g. a notification in its recipient's language. */
export function withLanguage<T>(lang: Language, fn: () => T): T {
  const prev = override;
  override = lang;
  try {
    return fn();
  } finally {
    override = prev;
  }
}

/** Inline bilingual text for sentences built from values: L(`Opens at ${t}`, `يفتح الساعة ${t}`). */
export const L = (en: string, ar: string) => (currentLanguage() === "ar" ? ar : en);

/**
 * Arabic counted nouns: 1 → "جلسة واحدة", 2 → "جلستين", 3–10 → "3 جلسات", 11+ → "11 جلسة".
 * `one`/`two` are complete phrases; `few`/`many` are the noun forms after the number.
 */
export function arCount(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  const r = n % 100;
  return n === 0 || (r >= 3 && r <= 10) ? `${n} ${few}` : `${n} ${many}`;
}

/** English + Arabic counted noun in one go. */
export const count = (n: number, en: [string, string], ar: [string, string, string, string]) => L(`${n} ${n === 1 ? en[0] : en[1]}`, arCount(n, ...ar));

/** Counted nouns used across the app: N.session(3) → "3 sessions" / "3 مواعيد". */
const noun = (en: [string, string], ar: [string, string, string, string]) => (n: number) => count(n, en, ar);
export const N = {
  session: noun(["session", "sessions"], ["موعد واحد", "موعدين", "مواعيد", "موعدًا"]),
  booking: noun(["booking", "bookings"], ["حجز واحد", "حجزين", "حجوزات", "حجزًا"]),
  facility: noun(["facility", "facilities"], ["مرفق واحد", "مرفقين", "مرافق", "مرفقًا"]),
  strike: noun(["strike", "strikes"], ["مخالفة واحدة", "مخالفتين", "مخالفات", "مخالفة"]),
  person: noun(["person", "people"], ["شخص واحد", "شخصين", "أشخاص", "شخصًا"]),
  day: noun(["day", "days"], ["يوم واحد", "يومين", "أيام", "يومًا"]),
  student: noun(["student", "students"], ["طالب واحد", "طالبين", "طلاب", "طالبًا"]),
  minute: noun(["minute", "minutes"], ["دقيقة واحدة", "دقيقتين", "دقائق", "دقيقة"]),
  hour: noun(["hour", "hours"], ["ساعة واحدة", "ساعتين", "ساعات", "ساعة"]),
  issue: noun(["issue", "issues"], ["بلاغ واحد", "بلاغين", "بلاغات", "بلاغًا"]),
  device: noun(["device", "devices"], ["جهاز واحد", "جهازين", "أجهزة", "جهازًا"]),
  request: noun(["request", "requests"], ["طلب واحد", "طلبين", "طلبات", "طلبًا"]),
  offer: noun(["offer", "offers"], ["عرض واحد", "عرضين", "عروض", "عرضًا"]),
  change: noun(["change", "changes"], ["تغيير واحد", "تغييرين", "تغييرات", "تغييرًا"]),
  group: noun(["group", "groups"], ["مجموعة واحدة", "مجموعتين", "مجموعات", "مجموعة"]),
  item: noun(["item", "items"], ["عنصر واحد", "عنصرين", "عناصر", "عنصرًا"]),
  week: noun(["week", "weeks"], ["أسبوع واحد", "أسبوعين", "أسابيع", "أسبوعًا"]),
  spot: noun(["spot", "spots"], ["مكان واحد", "مكانين", "أماكن", "مكانًا"]),
  line: noun(["line", "lines"], ["سطر واحد", "سطرين", "أسطر", "سطرًا"]),
  account: noun(["account", "accounts"], ["حساب واحد", "حسابين", "حسابات", "حسابًا"]),
};

/** The noun alone, when the number sits beside it (steppers): word(3, ["person", "people"], ["شخص", "أشخاص", "شخصًا"]). */
export function word(n: number, en: [string, string], ar: [string, string, string]): string {
  const r = n % 100;
  return L(n === 1 ? en[0] : en[1], n === 1 ? ar[0] : n === 0 || n === 2 || (r >= 3 && r <= 10) ? ar[1] : ar[2]);
}

/** Marks text for translation where it's defined (shared schemas); show it with t(). */
export const tx = (s: string) => s;
