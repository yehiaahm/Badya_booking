import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CheckCheck, Clock, Compass, ListOrdered, Sparkles, Ticket, UserX, XCircle } from "lucide-react";
import { api, type BookingView, type WaitlistView } from "@/api";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { useMyBookings, useMyWaitlist } from "@/lib/queries";
import { countdown, dayKey, fmtDayShort, fmtRange, relDay } from "@/lib/time";
import { TicketCard, TicketSkeleton, useQrSheet } from "@/components/booking/Ticket";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, Tabs } from "@/components/ui/Primitives";
import { toast } from "@/components/ui/Toast";
import { FacilityArt } from "@/components/facility/FacilityArt";
import { PageHeader } from "@/layouts/StudentLayout";
import { t as tr } from "@/i18n";

const TABS = ["upcoming", "active", "waitlist", "completed", "cancelled", "noshow"] as const;
type Tab = (typeof TABS)[number];

function groupByDay(list: BookingView[]) {
  const out: { day: string; items: BookingView[] }[] = [];
  for (const b of list) {
    const k = dayKey(b.start);
    const g = out.find((x) => x.day === k);
    if (g) g.items.push(b);
    else out.push({ day: k, items: [b] });
  }
  return out;
}

function WaitlistCard({ w }: { w: WaitlistView }) {
  const now = useNow(1000);
  const nav = useNavigate();
  const qc = useQueryClient();
  const leave = useMutation({
    mutationFn: () => api.waitlist.leave(w.entry.id),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.info(w.entry.status === "offered" ? tr("Offer declined") : tr("You left the waitlist"), w.entry.status === "offered" ? tr("The spot has moved to the next student.") : undefined);
    },
  });
  const offered = w.entry.status === "offered" && w.entry.offerExpiresAt && new Date(w.entry.offerExpiresAt) > now;
  const ended = w.entry.status === "expired" || w.entry.status === "left" || w.entry.status === "cancelled";
  return (
    <motion.article layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn("overflow-hidden rounded-[22px] border bg-surface shadow-sm", offered ? "border-brand/40 ring-4 ring-brand/10" : "border-line", ended && "opacity-60")}>
      <div className="flex gap-3.5 p-4">
        <FacilityArt motif={w.facility.media.motif} accent={w.facility.media.accent} imageUrl={w.facility.media.imageUrl} className="size-16 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-[15px] font-bold text-ink">{w.facility.name}</h3>
            {offered ? (
              <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-brand px-2.5 text-[11px] font-bold text-on-brand">
                <Sparkles className="size-3" />{" "}{tr("Spot held")}
              </span>
            ) : ended ? (
              <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-surface-2 px-2.5 text-[11px] font-bold text-muted">{w.entry.status === "expired" ? tr("Offer expired") : w.entry.status === "cancelled" ? tr("Session cancelled") : tr("Left")}</span>
            ) : (
              <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-violet-soft px-2.5 text-[11px] font-bold text-violet">
                <ListOrdered className="size-3" /> #{w.position}{" "}{tr("of")}{" "}{w.queueLength}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] font-semibold text-ink-2 tabular">
            {relDay(w.entry.start, now)}, {fmtRange(w.entry.start, w.entry.end)}
          </p>
          {!ended && !offered && (
            <div className="mt-2.5 flex items-center gap-1" aria-label={tr("Position {position} of {queueLength}", { position: w.position, queueLength: w.queueLength })}>
              {Array.from({ length: Math.max(w.queueLength, w.position) }, (_, i) => (
                <span key={i} className={cn("h-1.5 flex-1 rounded-full", i + 1 === w.position ? "bg-violet" : i + 1 < w.position ? "bg-violet/30" : "bg-surface-3")} />
              ))}
            </div>
          )}
          {!ended && !offered && <p className="mt-2 text-xs text-muted">{tr("We’ll hold a spot for")}{" "}{w.claimMinutes}{" "}{tr("min and notify you when one opens.")}</p>}
        </div>
      </div>
      {offered && (
        <div className="flex items-center gap-3 border-t border-brand/20 bg-brand-softer px-4 py-3">
          <Clock className="size-4 text-brand" />
          <p className="flex-1 text-[13px] font-semibold text-ink">
            {tr("Claim within")}{" "}<span className="tabular text-brand-strong">{countdown(new Date(w.entry.offerExpiresAt!).getTime() - now.getTime())}</span>
          </p>
          <Button size="sm" variant="ghost" onClick={() => leave.mutate()} loading={leave.isPending}>
            {tr("Decline")}
          </Button>
          <Button size="sm" onClick={() => nav(`/facility/${w.facility.id}?day=${dayKey(w.entry.start)}&claim=${w.entry.id}`)}>
            {tr("Claim spot")}
          </Button>
        </div>
      )}
      {!offered && !ended && (
        <div className="flex justify-end border-t border-line px-3 py-2">
          <Button size="xs" variant="ghost" onClick={() => leave.mutate()} loading={leave.isPending}>
            {tr("Leave waitlist")}
          </Button>
        </div>
      )}
    </motion.article>
  );
}

export function MyBookingsPage() {
  const [params, setParams] = useSearchParams();
  // Old or hand-typed links can carry a tab that doesn’t exist — fall back to upcoming.
  const tab: Tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "upcoming";
  const now = useNow(30000);
  const q = useMyBookings();
  const wl = useMyWaitlist();
  const qr = useQrSheet();
  const nav = useNavigate();

  const sets = useMemo(() => {
    const all = q.data ?? [];
    const t = now.getTime();
    const s = (b: BookingView) => new Date(b.start).getTime();
    const e = (b: BookingView) => new Date(b.end).getTime();
    return {
      upcoming: all.filter((b) => (b.status === "CONFIRMED" || b.status === "PENDING") && s(b) > t).sort((a, b) => s(a) - s(b)),
      active: all.filter((b) => b.status === "CHECKED_IN" || (b.status === "CONFIRMED" && s(b) <= t && e(b) > t)),
      completed: all.filter((b) => b.status === "COMPLETED").sort((a, b) => s(b) - s(a)),
      cancelled: all.filter((b) => b.status === "CANCELLED" || b.status === "EXPIRED").sort((a, b) => s(b) - s(a)),
      noshow: all.filter((b) => b.status === "NO_SHOW").sort((a, b) => s(b) - s(a)),
    };
  }, [q.data, now]);
  const waitActive = (wl.data ?? []).filter((w) => w.entry.status === "waiting" || w.entry.status === "offered");

  const items = [
    { value: "upcoming" as Tab, label: tr("Upcoming"), count: sets.upcoming.length, icon: <CalendarCheck className="size-4" /> },
    { value: "active" as Tab, label: tr("Active"), count: sets.active.length || undefined },
    { value: "waitlist" as Tab, label: tr("Waitlist"), count: waitActive.length || undefined },
    { value: "completed" as Tab, label: tr("Completed") },
    { value: "cancelled" as Tab, label: tr("Cancelled") },
    { value: "noshow" as Tab, label: tr("No-show"), count: sets.noshow.length || undefined },
  ];

  const empty: Record<Tab, { icon: typeof Ticket; title: string; body: string }> = {
    upcoming: { icon: Ticket, title: tr("You don’t have any upcoming bookings"), body: tr("Find a court, a pitch or a table — most have sessions free today.") },
    active: { icon: CalendarCheck, title: tr("Nothing happening right now"), body: tr("Sessions you’re checked in to show up here with their live QR code.") },
    waitlist: { icon: ListOrdered, title: tr("You’re not on any waitlists"), body: tr("When a session is full, join its waitlist and we’ll hold the next free spot for you.") },
    completed: { icon: CheckCheck, title: tr("No completed sessions yet"), body: tr("Sessions you attend will appear here.") },
    cancelled: { icon: XCircle, title: tr("No cancelled bookings"), body: tr("Nice — you’ve kept every booking.") },
    noshow: { icon: UserX, title: tr("No missed sessions"), body: tr("Keep it up! Missed sessions count as strikes and can pause your booking access.") },
  };

  const list: BookingView[] = tab === "waitlist" ? [] : sets[tab];
  const E = empty[tab];

  return (
    <div>
      <PageHeader title={tr("My bookings")} subtitle={q.data ? tr("{upcoming} upcoming · {completed} completed", { upcoming: sets.upcoming.length, completed: sets.completed.length }) : undefined} />
      <div className="sticky top-0 z-30 bg-bg/85 px-4 pt-1 backdrop-blur-md sm:px-6 lg:top-16">
        <Tabs items={items} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} />
      </div>
      <div className="px-4 pt-5 sm:px-6">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <TicketSkeleton key={i} />
            ))}
          </div>
        ) : tab === "waitlist" ? (
          (wl.data ?? []).length === 0 ? (
            <EmptyState icon={E.icon} title={E.title} body={E.body} action={<Button variant="secondary" icon={<Compass className="size-4" />} onClick={() => nav("/explore")}>{tr("Explore facilities")}</Button>} />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <AnimatePresence>
                {(wl.data ?? []).map((w) => (
                  <WaitlistCard key={w.entry.id} w={w} />
                ))}
              </AnimatePresence>
            </div>
          )
        ) : list.length === 0 ? (
          <EmptyState icon={E.icon} title={E.title} body={E.body} action={tab === "upcoming" || tab === "active" ? <Button icon={<Compass className="size-4" />} onClick={() => nav("/explore")}>{tr("Explore facilities")}</Button> : undefined} />
        ) : tab === "upcoming" ? (
          <div className="space-y-6">
            {groupByDay(list).map((g) => (
              <section key={g.day}>
                <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-faint">
                  {relDay(g.items[0].start, now)}
                  {relDay(g.items[0].start, now) !== fmtDayShort(g.items[0].start) && <span className="ms-1.5 font-semibold normal-case tracking-normal">· {fmtDayShort(g.items[0].start)}</span>}
                </h2>
                <div className="grid gap-3 lg:grid-cols-2">
                  <AnimatePresence>
                    {g.items.map((b) => (
                      <TicketCard key={b.id} b={b} onQr={() => qr.open(b)} />
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <>
            {tab === "noshow" && (
              <p className="mb-4 rounded-2xl bg-surface-2 p-3.5 text-[13px] leading-relaxed text-ink-2">
                {tr("Missed sessions count as strikes until they expire.")}{" "}<Link to="/profile" className="font-semibold text-brand hover:underline">{tr("See your standing")}</Link>{tr(". If you missed a session for a good reason, contact the facilities office — staff can waive a strike.")}
              </p>
            )}
            <div className="grid gap-3 lg:grid-cols-2">
              <AnimatePresence>
                {list.map((b) => (
                  <TicketCard key={b.id} b={b} onQr={() => qr.open(b)} highlight={tab === "active"} />
                ))}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>
      {qr.sheet}
    </div>
  );
}
