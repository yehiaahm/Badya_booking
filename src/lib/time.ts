import { addDays, addMinutes, differenceInCalendarDays, format as dfFormat, isSameDay, isToday, isTomorrow, startOfDay } from "date-fns";
import { arEG } from "date-fns/locale";
import { arCount, currentLanguage, L } from "@/i18n/lang";

/**
 * date-fns `format` in the current language. Arabic uses full day and month
 * names (abbreviations aren't used in Arabic) and the Arabic comma; digits
 * stay Western so times and dates read the same on every screen.
 */
export function format(d: Date | number, pattern: string): string {
  if (currentLanguage() !== "ar") return dfFormat(d, pattern);
  const p = pattern.replace(/(?<!M)MMM(?!M)/g, "MMMM").replace(/(?<!E)EEE(?!E)/g, "EEEE").replace(/,/g, "،").replace(/h:mm a/g, "h:mm aaa");
  return dfFormat(d, p, { locale: arEG });
}

/**
 * The app's clock, kept in step with the server so countdowns and check-in
 * windows are right even on a phone whose clock is a few minutes off.
 */
let offsetMs = 0;
const listeners = new Set<() => void>();

export const clock = {
  now(): Date {
    return new Date(Date.now() + offsetMs);
  },
  offset(): number {
    return offsetMs;
  },
  /** Align with the server's time (ignores sub-second network jitter). */
  syncTo(serverNow: Date) {
    const next = serverNow.getTime() - Date.now();
    if (Math.abs(next - offsetMs) < 1500) return;
    offsetMs = next;
    listeners.forEach((l) => l());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function parseHM(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map(Number);
  return { h, m };
}

export function atTime(day: Date, hm: string): Date {
  const { h, m } = parseHM(hm);
  const d = startOfDay(day);
  d.setHours(h, m, 0, 0);
  return d;
}

export function dayKey(d: Date | string): string {
  return dfFormat(typeof d === "string" ? new Date(d) : d, "yyyy-MM-dd");
}

export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export const t = (iso: string) => new Date(iso).getTime();

/* ───────── Formatting ───────── */

export function fmtTime(d: Date | string): string {
  return dfFormat(typeof d === "string" ? new Date(d) : d, "HH:mm");
}

export function fmtTime12(d: Date | string): string {
  return format(typeof d === "string" ? new Date(d) : d, "h:mm a");
}

export function fmtRange(start: string | Date, end: string | Date): string {
  return `${fmtTime(start)}–${fmtTime(end)}`;
}

export function relDay(d: Date | string, now = clock.now()): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isSameDay(date, now)) return L("Today", "اليوم");
  if (isSameDay(date, addDays(now, 1))) return L("Tomorrow", "غدًا");
  if (isSameDay(date, addDays(now, -1))) return L("Yesterday", "أمس");
  const diff = differenceInCalendarDays(date, now);
  if (diff > 0 && diff < 7) return format(date, "EEEE");
  return format(date, "EEE, d MMM");
}

export function fmtDayLong(d: Date | string): string {
  return format(typeof d === "string" ? new Date(d) : d, "EEEE, d MMMM yyyy");
}

export function fmtDayShort(d: Date | string): string {
  return format(typeof d === "string" ? new Date(d) : d, "EEE, d MMM");
}

export function fmtDateTime(d: Date | string): string {
  return format(typeof d === "string" ? new Date(d) : d, "d MMM yyyy, HH:mm");
}

/** "in 2 h 15 min", "in 12 min", "now", "3 h ago" */
export function fmtRelative(d: Date | string, now = clock.now()): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const mins = Math.round((date.getTime() - now.getTime()) / 60000);
  const abs = Math.abs(mins);
  if (abs < 1) return L("now", "الآن");
  let en: string;
  let ar: string;
  if (abs < 60) {
    en = `${abs} min`;
    ar = arMinutes(abs);
  } else if (abs < 60 * 24) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    en = m && h < 6 ? `${h} h ${m} min` : `${h} h`;
    ar = m && h < 6 ? `${arHours(h)} و${arMinutes(m)}` : arHours(h);
  } else {
    const days = Math.round(abs / 1440);
    en = days === 1 ? "1 day" : `${days} days`;
    ar = arCount(days, "يوم", "يومين", "أيام", "يومًا");
  }
  return mins > 0 ? L(`in ${en}`, `بعد ${ar}`) : L(`${en} ago`, `منذ ${ar}`);
}

const arMinutes = (n: number) => arCount(n, "دقيقة", "دقيقتين", "دقائق", "دقيقة");
const arHours = (n: number) => arCount(n, "ساعة", "ساعتين", "ساعات", "ساعة");

export function fmtAgo(d: Date | string, now = clock.now()): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const mins = Math.round((now.getTime() - date.getTime()) / 60000);
  if (mins < 1) return L("Just now", "الآن");
  if (mins < 60) return L(`${mins} min ago`, `منذ ${arMinutes(mins)}`);
  if (mins < 60 * 24) return L(`${Math.floor(mins / 60)} h ago`, `منذ ${arHours(Math.floor(mins / 60))}`);
  if (isSameDay(date, addDays(now, -1))) return L(`Yesterday, ${fmtTime(date)}`, `أمس، ${fmtTime(date)}`);
  return format(date, "d MMM, HH:mm");
}

export function greeting(now = clock.now()): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return L("Good morning", "صباح الخير");
  if (h >= 12 && h < 17) return L("Good afternoon", "مساء الخير");
  return L("Good evening", "مساء الخير");
}

export function countdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export { addDays, addMinutes, startOfDay, isSameDay, isToday, isTomorrow };
