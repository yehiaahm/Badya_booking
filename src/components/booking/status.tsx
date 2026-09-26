import { CalendarCheck, CheckCheck, CircleDot, Clock3, Hourglass, ListOrdered, UserX, XCircle, type LucideIcon } from "lucide-react";
import type { BookingStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import type { Tone } from "@/components/ui/Primitives";
import { t } from "@/i18n";

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  /** Accent colour for ticket stubs and calendar blocks. */
  color: string;
  description: string;
}

export const BOOKING_STATUS: Record<BookingStatus, StatusMeta> = {
  PENDING: { get label() {
    return t("Pending approval");
  }, tone: "warning", icon: Hourglass, color: "var(--warning)", get description() {
    return t("Waiting for staff to review your request.");
  } },
  CONFIRMED: { get label() {
    return t("Confirmed");
  }, tone: "info", icon: CalendarCheck, color: "var(--info)", get description() {
    return t("You’re booked. Show your QR code when you arrive.");
  } },
  CHECKED_IN: { get label() {
    return t("Checked in");
  }, tone: "success", icon: CircleDot, color: "var(--success)", get description() {
    return t("Session in progress — enjoy!");
  } },
  COMPLETED: { get label() {
    return t("Completed");
  }, tone: "neutral", icon: CheckCheck, color: "var(--faint)", get description() {
    return t("You attended this session.");
  } },
  CANCELLED: { get label() {
    return t("Cancelled");
  }, tone: "neutral", icon: XCircle, color: "var(--line-strong)", get description() {
    return t("This booking was cancelled.");
  } },
  NO_SHOW: { get label() {
    return t("No-show");
  }, tone: "danger", icon: UserX, color: "var(--danger)", get description() {
    return t("Nobody checked in before the grace period ended.");
  } },
  EXPIRED: { get label() {
    return t("Expired");
  }, tone: "neutral", icon: Clock3, color: "var(--line-strong)", get description() {
    return t("The request wasn’t approved before the session started.");
  } },
  WAITLISTED: { get label() {
    return t("On waitlist");
  }, tone: "violet", icon: ListOrdered, color: "var(--violet)", get description() {
    return t("We’ll notify you when a spot opens.");
  } },
};

export function StatusBadge({ status, size = "sm", className }: { status: BookingStatus; size?: "xs" | "sm"; className?: string }) {
  const m = BOOKING_STATUS[status];
  const Icon = m.icon;
  const tone: Record<Tone, string> = {
    neutral: "bg-surface-2 text-ink-2 ring-line",
    brand: "bg-brand-soft text-brand-strong ring-brand/15",
    success: "bg-success-soft text-success ring-success/20",
    warning: "bg-warning-soft text-warning ring-warning/20",
    danger: "bg-danger-soft text-danger ring-danger/20",
    info: "bg-info-soft text-info ring-info/20",
    violet: "bg-violet-soft text-violet ring-violet/20",
    dusk: "bg-dusk text-on-dusk ring-transparent",
  };
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full font-semibold whitespace-nowrap ring-1 ring-inset", size === "xs" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs", tone[m.tone], status === "CANCELLED" && "line-through decoration-1", className)}>
      {status === "CHECKED_IN" ? <span className="live-dot size-1.5 rounded-full bg-current" /> : <Icon className={size === "xs" ? "size-3" : "size-3.5"} strokeWidth={2.2} />}
      {m.label}
    </span>
  );
}
