import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Compass, ListOrdered } from "lucide-react";
import type { BookingView, WaitlistView } from "@/api";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { downloadIcs } from "@/lib/ics";
import { useMyBookings, useMyWaitlist } from "@/lib/queries";
import { dayKey, fmtDayLong, fmtRange, format, fromDayKey, isSameDay, relDay } from "@/lib/time";
import { BOOKING_STATUS } from "@/components/booking/status";
import { TicketCard, useQrSheet } from "@/components/booking/Ticket";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { PageHeader } from "@/layouts/StudentLayout";
import { L, N, t } from "@/i18n";

// Matches the campus default (settings.weekStartsOn) — the week starts on Saturday.
const WEEK_STARTS_ON = 6 as const;
const HIDDEN = new Set<BookingView["status"]>(["CANCELLED", "EXPIRED"]);

export function CalendarPage() {
  const now = useNow(60000);
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = useMyBookings();
  const wl = useMyWaitlist();
  const qr = useQrSheet();

  const selected = params.get("day") ? fromDayKey(params.get("day")!) : now;
  const month = params.get("month") ? fromDayKey(`${params.get("month")}-01`) : startOfMonth(selected);
  const select = (d: Date) => setParams({ day: dayKey(d), month: format(d, "yyyy-MM") }, { replace: true });
  const showMonth = (m: Date) => setParams((p) => ({ ...Object.fromEntries(p), month: format(m, "yyyy-MM") }), { replace: true });

  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: WEEK_STARTS_ON }), end: endOfWeek(endOfMonth(month), { weekStartsOn: WEEK_STARTS_ON }) }), [month]);

  const byDay = useMemo(() => {
    const m = new Map<string, BookingView[]>();
    for (const b of q.data ?? []) {
      if (HIDDEN.has(b.status)) continue;
      const k = dayKey(b.start);
      m.set(k, [...(m.get(k) ?? []), b]);
    }
    return m;
  }, [q.data]);

  const waitByDay = useMemo(() => {
    const m = new Map<string, WaitlistView[]>();
    for (const w of wl.data ?? []) {
      if (w.entry.status !== "waiting" && w.entry.status !== "offered") continue;
      const k = dayKey(w.entry.start);
      m.set(k, [...(m.get(k) ?? []), w]);
    }
    return m;
  }, [wl.data]);

  const upcoming = (q.data ?? []).filter((b) => (b.status === "CONFIRMED" || b.status === "PENDING") && new Date(b.start) > now);
  const inMonth = (q.data ?? []).filter((b) => !HIDDEN.has(b.status) && isSameMonth(new Date(b.start), month)).length;
  const selKey = dayKey(selected);
  const dayBookings = byDay.get(selKey) ?? [];
  const dayWaits = waitByDay.get(selKey) ?? [];
  const isPastDay = selected < new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return (
    <div>
      <PageHeader
        title={t("Calendar")}
        subtitle={q.data ? t("{sessions} in {month}", { sessions: N.session(inMonth), month: format(month, "MMMM") }) : undefined}
        actions={
          upcoming.length > 0 && (
            <Button variant="secondary" size="sm" icon={<CalendarPlus className="size-4" />} onClick={() => downloadIcs(upcoming)} aria-label={t("Export {length} upcoming bookings to your calendar", { length: upcoming.length })}>
              <span className="hidden sm:inline">{t("Export upcoming")}</span>
            </Button>
          )
        }
      />

      <div className="grid gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-3 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-ink" aria-live="polite">
              {format(month, "MMMM yyyy")}
            </h2>
            <div className="flex items-center gap-1">
              {!isSameMonth(month, now) && (
                <Button variant="ghost" size="sm" onClick={() => select(now)}>
                  {t("Today")}
                </Button>
              )}
              <IconButton label={t("Previous month")} variant="soft" size="sm" onClick={() => showMonth(addMonths(month, -1))}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <IconButton label={t("Next month")} variant="soft" size="sm" onClick={() => showMonth(addMonths(month, 1))}>
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
          </div>

          {q.isError ? (
            <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <div>
              <div className="grid grid-cols-7 pb-1" aria-hidden>
                {days.slice(0, 7).map((d) => (
                  <span key={d.getDay()} className="text-center text-[11px] font-bold uppercase tracking-wider text-faint">
                    {format(d, "EEEEE")}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-line bg-line">
                {days.map((d) => {
                  const k = dayKey(d);
                  const items = byDay.get(k) ?? [];
                  const waits = waitByDay.get(k) ?? [];
                  const sel = k === selKey;
                  const today = isSameDay(d, now);
                  const out = !isSameMonth(d, month);
                  const count = items.length + waits.length;
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={sel}
                      aria-label={`${fmtDayLong(d)}${count ? `${L(", ", "، ")}${N.item(count)}` : ""}`}
                      onClick={() => select(d)}
                      className={cn("relative flex min-h-[64px] flex-col items-stretch gap-1 p-1.5 text-start transition-colors sm:min-h-[104px] sm:p-2", out ? "bg-surface-2/60" : "bg-surface", sel ? "bg-brand-softer" : "hover:bg-surface-2")}
                    >
                      {sel && <motion.span layoutId="cal-sel" className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-brand" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                      <span className={cn("flex size-7 items-center justify-center self-center rounded-full text-[13px] font-bold tabular sm:self-start", today ? "bg-brand text-on-brand" : out ? "text-faint" : "text-ink")}>{format(d, "d")}</span>
                      {!q.data ? (
                        <Skeleton className="mx-auto hidden h-3 w-3/4 sm:block" />
                      ) : (
                        <>
                          <span className="flex flex-wrap justify-center gap-0.5 sm:hidden" aria-hidden>
                            {items.slice(0, 3).map((b) => (
                              <span key={b.id} className="size-1.5 rounded-full" style={{ background: b.status === "NO_SHOW" ? BOOKING_STATUS.NO_SHOW.color : b.category.color }} />
                            ))}
                            {waits.length > 0 && <span className="size-1.5 rounded-full border border-violet" />}
                          </span>
                          <span className="hidden min-w-0 flex-col gap-0.5 sm:flex" aria-hidden>
                            {items.slice(0, 2).map((b) => (
                              <span key={b.id} className={cn("truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold", b.status === "NO_SHOW" ? "bg-danger-soft text-danger line-through" : b.status === "COMPLETED" ? "bg-surface-2 text-muted" : "text-ink")} style={b.status === "NO_SHOW" || b.status === "COMPLETED" ? undefined : { background: `color-mix(in srgb, ${b.category.color} 18%, transparent)` }}>
                                {format(new Date(b.start), "HH:mm")} {b.facility.name}
                              </span>
                            ))}
                            {waits.slice(0, items.length >= 2 ? 0 : 2 - items.length).map((w) => (
                              <span key={w.entry.id} className="truncate rounded-md border border-dashed border-violet/50 px-1.5 py-0.5 text-[11px] font-semibold text-violet">
                                {format(new Date(w.entry.start), "HH:mm")} {w.facility.name}
                              </span>
                            ))}
                            {count > 2 && <span className="px-1.5 text-[11px] font-semibold text-muted">+{count - 2}{" "}{t("more")}</span>}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-brand" />{" "}{t("Today")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full border border-violet" />{" "}{t("On a waitlist")}
                </span>
                <span>{t("Cancelled bookings aren’t shown.")}</span>
              </p>
            </div>
          )}
        </Card>

        <section aria-labelledby="cal-day" className="lg:sticky lg:top-24 lg:self-start">
          <h2 id="cal-day" className="mb-3 text-base font-bold text-ink">
            {relDay(selected, now)}
            {relDay(selected, now) !== format(selected, "EEE, d MMM") && <span className="ms-1.5 font-semibold text-muted">· {format(selected, "EEE, d MMM")}</span>}
          </h2>
          {!q.data ? (
            <Skeleton className="h-28 rounded-[22px]" />
          ) : dayBookings.length === 0 && dayWaits.length === 0 ? (
            <EmptyState
              compact
              icon={CalendarDays}
              title={isPastDay ? t("Nothing on this day") : t("Nothing booked yet")}
              body={isPastDay ? undefined : t("Most facilities have free sessions — pick one and choose this day.")}
              action={
                !isPastDay && (
                  <Button variant="secondary" size="sm" icon={<Compass className="size-4" />} onClick={() => nav("/explore")}>
                    {t("Find a session")}
                  </Button>
                )
              }
            />
          ) : (
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {dayBookings.map((b) => (
                  <TicketCard key={b.id} b={b} onQr={() => qr.open(b)} />
                ))}
              </AnimatePresence>
              {dayWaits.map((w) => (
                <Link key={w.entry.id} to="/bookings?tab=waitlist" className="flex items-center gap-3 rounded-[22px] border border-dashed border-violet/40 bg-violet-soft/40 p-4 transition-colors hover:bg-violet-soft">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-soft text-violet">
                    <ListOrdered className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink">{w.facility.name}</span>
                    <span className="block text-xs text-muted tabular">
                      {fmtRange(w.entry.start, w.entry.end)} · {w.entry.status === "offered" ? t("Spot held for you") : t("#{n} on the waitlist", { n: w.position })}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      {qr.sheet}
    </div>
  );
}
