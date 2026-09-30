import { useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { ChevronRight, Clock, MapPin, QrCode as QrIcon, ShieldCheck, Sun } from "lucide-react";
import type { BookingView } from "@/api";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { useQrToken } from "@/lib/queries";
import { format, fmtRange, fmtRelative, relDay } from "@/lib/time";
import { Sheet } from "@/components/ui/Overlay";
import { Ring, Skeleton, AvatarStack } from "@/components/ui/Primitives";
import { ErrorState } from "@/components/ui/Primitives";
import { BOOKING_STATUS, StatusBadge } from "./status";
import { QrCode } from "./QrCode";
import { L, t } from "@/i18n";

export function whereLabel(b: BookingView) {
  const f = b.facility;
  return [b.unitName, f.location.building, f.location.floor ?? f.location.area].filter(Boolean).join(" · ");
}

/** Ticket-style booking card with a date stub and perforation. */
export function TicketCard({ b, onQr, className, highlight }: { b: BookingView; onQr?: () => void; className?: string; highlight?: boolean }) {
  const now = useNow(30000);
  const meta = BOOKING_STATUS[b.status];
  const start = new Date(b.start);
  const upcoming = (b.status === "CONFIRMED" || b.status === "PENDING" || b.status === "AWAITING_PLAYERS") && start > now;
  const soon = upcoming && start.getTime() - now.getTime() < 24 * 3600000;
  const faded = b.status === "CANCELLED" || b.status === "EXPIRED";
  const qrAvailable = (b.status === "CONFIRMED" || b.status === "CHECKED_IN") && b.relation === "booker";
  const waiting = b.status === "AWAITING_PLAYERS" && b.playersDeadline ? b.playersDeadline : null;
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={cn("group relative flex overflow-hidden rounded-[22px] border bg-surface shadow-sm transition-shadow hover:shadow-md", highlight ? "border-brand/40 ring-4 ring-brand/10" : "border-line", className)}
    >
      <span className="absolute inset-y-0 start-0 w-1" style={{ background: meta.color }} aria-hidden />
      <div className={cn("flex w-[76px] shrink-0 flex-col items-center justify-center py-4 ps-1 sm:w-[88px]", faded && "opacity-50")}>
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted">{format(start, "EEE")}</span>
        <span className="font-display text-[40px] leading-none text-ink">{format(start, "d")}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{format(start, "MMM")}</span>
      </div>
      <div className="relative w-0 border-s-2 border-dashed border-line" aria-hidden>
        <span className="absolute -start-[9px] -top-2 size-4 rounded-full border border-line bg-bg" />
        <span className="absolute -bottom-2 -start-[9px] size-4 rounded-full border border-line bg-bg" />
      </div>
      <div className="min-w-0 flex-1 p-4 ps-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className={cn("truncate text-[15px] font-bold text-ink", faded && "text-muted line-through decoration-1")}>{b.facility.name}</h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink-2 tabular">
              <Clock className="size-3.5 text-muted" />
              {relDay(b.start, now)}{L(", ", "، ")}{fmtRange(b.start, b.end)}
            </p>
          </div>
          <StatusBadge status={b.status} size="xs" />
        </div>
        <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted">
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">{whereLabel(b)}</span>
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {b.people.length > 0 && <AvatarStack people={[b.booker, ...b.people]} size={22} max={4} />}
            {b.relation === "participant" || b.relation === "invited" ? (
              <span className="truncate text-xs text-muted">{t("Booked by")}{" "}{b.booker.name.split(" ")[0]}</span>
            ) : waiting ? (
              <span className="truncate text-xs font-semibold text-warning">{t("Waiting for {n} more to accept · until {time}", { n: b.playersNeeded, time: format(new Date(waiting), "HH:mm") })}</span>
            ) : soon ? (
              <span className="truncate text-xs font-semibold text-brand">{t("Starts")}{" "}{fmtRelative(b.start, now)}</span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {qrAvailable && onQr && (
              <button onClick={onQr} className="relative z-10 flex h-8 items-center gap-1.5 rounded-full bg-brand-soft px-3 text-xs font-bold text-brand-strong transition-colors hover:bg-brand hover:text-on-brand">
                <QrIcon className="size-3.5" />{" "}{t("QR")}
              </button>
            )}
            <Link to={`/bookings/${b.id}`} className="flex h-8 items-center gap-0.5 rounded-full px-2.5 text-xs font-bold text-ink-2 after:absolute after:inset-0 hover:bg-surface-2" aria-label={t("View details of {name} booking", { name: b.facility.name })}>
              {t("Details")}{" "}<ChevronRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

export function TicketSkeleton() {
  return (
    <div className="flex overflow-hidden rounded-[22px] border border-line bg-surface">
      <div className="flex w-[88px] flex-col items-center justify-center gap-2 py-5">
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-9 w-10" />
        <Skeleton className="h-3 w-8" />
      </div>
      <div className="flex-1 space-y-2.5 border-s-2 border-dashed border-line p-4">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

/** Live QR — refreshes every rotation window so screenshots can't be shared. */
export function LiveQr({ bookingId, size = 220 }: { bookingId: string; size?: number }) {
  const q = useQrToken(bookingId, true);
  const now = useNow(250);
  if (q.isError) return <ErrorState compact error={q.error} />;
  if (!q.data)
    return (
      <div className="flex flex-col items-center">
        <Skeleton className="rounded-2xl" style={{ width: size, height: size } as React.CSSProperties} />
      </div>
    );
  const remaining = new Date(q.data.expiresAt).getTime() - now.getTime();
  const frac = Math.max(0, Math.min(1, remaining / (q.data.rotationSeconds * 1000)));
  return (
    <div className="flex flex-col items-center">
      <motion.div key={q.data.token} initial={{ opacity: 0.4, filter: "blur(6px)", scale: 0.96 }} animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="rounded-3xl bg-white p-3 shadow-md ring-1 ring-black/5">
        <QrCode value={q.data.token} size={size} />
      </motion.div>
      <div className="mt-4 flex items-center gap-2.5 text-xs text-muted">
        <Ring value={frac} size={22} stroke={3}>
          <span className="sr-only">{t("Refreshes in")}{" "}{Math.ceil(remaining / 1000)}{" "}{t("seconds")}</span>
        </Ring>
        <span>
          {t("Refreshes in")}{" "}<span className="font-bold text-ink tabular">{Math.max(0, Math.ceil(remaining / 1000))}s</span>{" "}{t("— screenshots won’t scan")}
        </span>
      </div>
    </div>
  );
}

export function QrSheet({ b, open, onClose }: { b: BookingView | null; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open && !!b} onClose={onClose} title={t("Your check-in code")} description={t("Show this to the staff member at the facility.")}>
      {b && (
        <div className="flex flex-col items-center pb-2">
          <LiveQr bookingId={b.id} />
          <div className="mt-6 w-full rounded-2xl bg-surface-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-bold text-ink">{b.facility.name}</p>
                <p className="text-sm text-ink-2 tabular">
                  {relDay(b.start)}{L(", ", "، ")}{fmtRange(b.start, b.end)}
                </p>
                <p className="mt-0.5 text-xs text-muted">{whereLabel(b)}</p>
              </div>
              <StatusBadge status={b.status} size="xs" />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs">
              <span className="text-muted">{t("Booking ID")}</span>
              <span className="font-mono font-semibold text-ink">{b.id}</span>
            </div>
          </div>
          <div className="mt-4 grid w-full grid-cols-2 gap-2 text-xs text-muted">
            <p className="flex items-center gap-1.5">
              <Sun className="size-3.5 shrink-0" />{" "}{t("Turn up your brightness")}
            </p>
            <p className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0" />{" "}{t("Signed & tamper-proof")}
            </p>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function useQrSheet() {
  const [b, setB] = useState<BookingView | null>(null);
  return { open: (x: BookingView) => setB(x), sheet: <QrSheet b={b} open={!!b} onClose={() => setB(null)} /> };
}
