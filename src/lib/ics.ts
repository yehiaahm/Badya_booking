import type { BookingView } from "@/api";
import { t } from "@/i18n";

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

function event(b: BookingView, now: string): string[] {
  const where = [b.unitName, b.facility.location.building, b.facility.location.floor ?? b.facility.location.area].filter(Boolean).join(", ");
  return [
    "BEGIN:VEVENT",
    `UID:${b.id}@spaces.badya.edu.eg`,
    `DTSTAMP:${now}`,
    `DTSTART:${stamp(b.start)}`,
    `DTEND:${stamp(b.end)}`,
    `SUMMARY:${esc(b.facility.name)}`,
    `LOCATION:${esc(where)}`,
    `DESCRIPTION:${esc(t("Booking {id}. Show your QR code in Badya Spaces to check in.", { id: b.id }))}`,
    ...(b.status === "PENDING" ? ["STATUS:TENTATIVE"] : ["STATUS:CONFIRMED"]),
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(t("{name} starts in 30 minutes", { name: b.facility.name }))}`,
    "END:VALARM",
    "END:VEVENT",
  ];
}

/** Build an iCalendar file for one or more bookings and hand it to the browser. */
export function downloadIcs(bookings: BookingView | BookingView[], filename?: string) {
  const list = Array.isArray(bookings) ? bookings : [bookings];
  if (!list.length) return;
  const now = stamp(new Date().toISOString());
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Badya University//Badya Spaces//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...list.flatMap((b) => event(b, now)), "END:VCALENDAR"].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? (list.length === 1 ? `${slug(list[0].facility.name)}-${list[0].id}.ics` : "badya-spaces-bookings.ics");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
