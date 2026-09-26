import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { useMutation } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, ChevronDown, Clock, Hourglass, MapPin, ScanLine, UserCheck, UserX, Users, Wrench } from "lucide-react";
import { api, type StaffSession, type StaffSessionBooking } from "@/api";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { errorMessage, useStaffOverview } from "@/lib/queries";
import { fmtDayLong, fmtDayShort, fmtRange, fmtRelative, fmtTime, format } from "@/lib/time";
import { useCan, useSession } from "@/state/session";
import { StatusBadge } from "@/components/booking/status";
import { locationLabel } from "@/components/facility/FacilityCard";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Form";
import { Avatar, Badge, Card, EmptyState, ErrorState, ProgressBar, Skeleton, Stat } from "@/components/ui/Primitives";
import { Dialog } from "@/components/ui/Overlay";
import { toast } from "@/components/ui/Toast";
import { CloseDialog, FacilityActions, FacilityPicker, IssueList, ReportIssueDialog, useStaffFacility } from "./shared";
import { L, N, t as tr } from "@/i18n";

type Pending = { kind: "noshow" | "waive"; b: StaffSessionBooking } | null;
const WAIVE_REASONS = () => [tr("Medical reason"), tr("Official university event"), tr("Facility issue on arrival"), tr("Checked in but not recorded")];

function BookingRow({ b, onAsk }: { b: StaffSessionBooking; onAsk: (p: Pending) => void }) {
  const canNoShow = useCan("noshow.mark");
  const canCheckIn = useCan("checkin.perform");
  const headcount = b.people.length ? b.people.length + 1 : undefined;
  const check = useMutation({
    mutationFn: () => api.staff.checkIn(b.id, headcount),
    onSuccess: () => toast.success(tr("{name} checked in", { name: b.booker.name }), headcount ? N.person(headcount) : undefined),
    onError: (e) => toast.error(tr("Couldn’t check in"), errorMessage(e)),
  });
  const waived = !!b.noShow?.waived;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <Avatar name={b.booker.name} hue={b.booker.avatarHue} size={34} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
          {b.booker.name}
          {b.people.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted">
              <Users className="size-3" />+{b.people.length}
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted">
          {[b.unitName, b.booker.universityId, b.checkIn ? (b.checkIn.method === "manual" ? tr("in at {time} (manual)", { time: fmtTime(b.checkIn.at) }) : tr("in at {time}", { time: fmtTime(b.checkIn.at) })) : null].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {b.late && !b.canMarkNoShow && (
          <Badge size="xs" tone="warning" icon={<Hourglass className="size-3" />}>
            {tr("Late")}
          </Badge>
        )}
        {waived ? (
          <Badge size="xs" tone="success">
            {tr("Strike waived")}
          </Badge>
        ) : (
          <StatusBadge status={b.status} size="xs" />
        )}
        {canCheckIn && b.canCheckIn && (
          <Button size="xs" variant="soft" icon={<UserCheck className="size-3.5" />} loading={check.isPending} onClick={() => check.mutate()}>
            {tr("Check in")}
          </Button>
        )}
        {canNoShow && b.canMarkNoShow && (
          <Button size="xs" variant="danger-soft" icon={<UserX className="size-3.5" />} onClick={() => onAsk({ kind: "noshow", b })}>
            {tr("No-show")}
          </Button>
        )}
        {canNoShow && b.status === "NO_SHOW" && !waived && (
          <Button size="xs" variant="ghost" onClick={() => onAsk({ kind: "waive", b })}>
            {tr("Waive strike")}
          </Button>
        )}
      </div>
    </li>
  );
}

function SessionBlock({ s, unitLabel, onAsk }: { s: StaffSession; unitLabel: string; onAsk: (p: Pending) => void }) {
  const now = useNow(30000);
  const active = s.bookings.filter((b) => b.status !== "CANCELLED" && b.status !== "EXPIRED");
  const checkedIn = active.filter((b) => b.status === "CHECKED_IN" || b.status === "COMPLETED").length;
  const live = s.state === "now";
  return (
    <section id={`session-${s.start}`} className={cn("scroll-mt-28 rounded-[22px] border bg-surface p-4 shadow-sm", live ? "border-brand/40 ring-4 ring-brand/10" : "border-line", s.state === "past" && "opacity-75")}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-base font-bold text-ink tabular">{fmtRange(s.start, s.end)}</h3>
        {live && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-bold text-on-brand">
            <span className="live-dot size-1.5 rounded-full bg-current" />{" "}{tr("Now")}
          </span>
        )}
        {s.state === "next" && (
          <Badge size="xs" tone="info">
            {tr("Next ·")}{" "}{fmtRelative(s.start, now)}
          </Badge>
        )}
        <span className="ms-auto text-xs font-semibold text-muted tabular">
          {active.length}/{s.unitCount} {s.unitCount === 1 ? tr("booked") : L(`${unitLabel}s`, tr("booked"))}
          {active.length > 0 && s.state !== "later" && s.state !== "next" && ` · ${tr("{n} in", { n: checkedIn })}`}
        </span>
      </header>
      {s.maintenance && (
        <p className="mt-2 flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">
          <Wrench className="size-3.5" />{" "}{tr("Closed —")}{" "}{s.maintenance.reason}
        </p>
      )}
      {s.bookings.length ? (
        <ul className="mt-1 divide-y divide-line">
          {s.bookings.map((b) => (
            <BookingRow key={b.id} b={b} onAsk={onAsk} />
          ))}
        </ul>
      ) : (
        !s.maintenance && <p className="mt-2 text-sm text-faint">{tr("No bookings")}</p>
      )}
    </section>
  );
}

export function StaffTodayPage() {
  const now = useNow(30000);
  const nav = useNavigate();
  const user = useSession((s) => s.user)!;
  const q = useStaffOverview();
  const { current, select } = useStaffFacility(q.data);
  const [showPast, setShowPast] = useState(false);
  const [dialog, setDialog] = useState<"report" | "close" | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState("");
  const scrolled = useRef<string | null>(null);

  const noShow = useMutation({
    mutationFn: (id: string) => api.staff.markNoShow(id),
    onSuccess: (b) => {
      toast.info(tr("Marked as no-show"), tr("{name} has been notified and a strike was recorded.", { name: b.booker.name }));
      setPending(null);
    },
    onError: (e) => toast.error(tr("Couldn’t mark no-show"), errorMessage(e)),
  });
  const waive = useMutation({
    mutationFn: (v: { id: string; reason: string }) => api.staff.undoNoShow(v.id, v.reason),
    onSuccess: (b) => {
      toast.success(tr("Strike waived"), tr("{name} has been told.", { name: b.booker.name }));
      setPending(null);
    },
    onError: (e) => toast.error(tr("Couldn’t waive"), errorMessage(e)),
  });

  // Bring the live (or next) session into view once per facility.
  useEffect(() => {
    if (!current || scrolled.current === current.facility.id) return;
    scrolled.current = current.facility.id;
    const target = current.sessions.find((s) => s.state === "now") ?? current.sessions.find((s) => s.state === "next");
    if (target && current.sessions.indexOf(target) > 1) requestAnimationFrame(() => document.getElementById(`session-${target.start}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [current]);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} className="mt-10" />;
  if (!q.data)
    return (
      <div className="space-y-4 pt-8">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-24 rounded-[22px]" />
        <Skeleton className="h-64 rounded-[22px]" />
      </div>
    );
  if (!current)
    return <EmptyState icon={CalendarClock} title={tr("No facilities assigned to you")} body={tr("Ask the facilities office to assign you to the spaces you supervise.")} className="mt-16" />;

  const f = current.facility;
  const past = current.sessions.filter((s) => s.state === "past");
  const rest = current.sessions.filter((s) => s.state !== "past");
  const t = q.data.totals;
  const occ = current.occupancyNow;

  return (
    <div className="pt-6 sm:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted">{fmtDayLong(now)}</p>
          <h1 className="font-display text-[34px] leading-none text-ink sm:text-[40px]">{tr("Hi,")}{" "}{user.name.split(" ")[0]}</h1>
        </div>
        <div className="hidden md:block">
          <Button size="lg" icon={<ScanLine className="size-5" />} onClick={() => nav(`/staff/scan?f=${f.id}`)}>
            {tr("Scan tickets")}
          </Button>
        </div>
      </div>

      <Card className="mt-5 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
        <Stat label={tr("Booked today")} value={t.booked} icon={<CalendarClock />} />
        <Stat label={tr("Checked in")} value={t.checkedIn} icon={<CheckCircle2 />} tone="success" />
        <Stat label={tr("Still to arrive")} value={t.awaiting} icon={<Clock />} />
        <Stat label={tr("No-shows")} value={t.noShows} icon={<UserX />} tone={t.noShows ? "danger" : undefined} />
      </Card>

      <div className="mt-6">
        <FacilityPicker overview={q.data} value={f.id} onChange={select} />
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-ink">{f.name}</h2>
                <p className="flex items-center gap-1 text-sm text-muted">
                  <MapPin className="size-3.5" /> {locationLabel(f)}
                </p>
              </div>
              <FacilityActions facility={current} onReport={() => setDialog("report")} onClose={() => setDialog("close")} />
            </div>
            {f.status !== "active" ? (
              <p className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{tr("Closed —")}{" "}{f.inactiveReason ?? "not taking bookings"}</p>
            ) : occ ? (
              <div className="mt-4">
                <p className="flex justify-between text-xs font-semibold text-muted">
                  <span>{tr("Right now")}</span>
                  <span className="tabular">
                    {occ.checkedIn}{" "}{tr("checked in ·")}{" "}{occ.taken}/{occ.capacity}{" "}{tr("booked")}
                  </span>
                </p>
                <ProgressBar value={occ.taken} max={occ.capacity} tone={occ.taken >= occ.capacity ? "warning" : "brand"} className="mt-1.5" label={tr("{taken} of {capacity} booked right now", { taken: occ.taken, capacity: occ.capacity })} />
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted">{tr("No session running right now.")}</p>
            )}
          </Card>

          {current.sessions.length === 0 ? (
            <EmptyState compact icon={CalendarClock} title={tr("Closed today")} body={tr("There are no sessions scheduled at this facility today.")} />
          ) : (
            <>
              {past.length > 0 && (
                <button type="button" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast} className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line py-2.5 text-sm font-semibold text-muted hover:text-ink">
                  {showPast ? tr("Hide {sessions} earlier", { sessions: N.session(past.length) }) : tr("Show {sessions} earlier", { sessions: N.session(past.length) })}
                  <ChevronDown className={cn("size-4 transition-transform", showPast && "rotate-180")} />
                </button>
              )}
              <AnimatePresence initial={false}>
                {showPast &&
                  past.map((s) => (
                    <motion.div key={s.start} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                      <SessionBlock s={s} unitLabel={f.unitLabel} onAsk={setPending} />
                    </motion.div>
                  ))}
              </AnimatePresence>
              {rest.map((s) => (
                <SessionBlock key={s.start} s={s} unitLabel={f.unitLabel} onAsk={setPending} />
              ))}
              {rest.length === 0 && <p className="py-6 text-center text-sm text-muted">{tr("All of today’s sessions are over.")}</p>}
            </>
          )}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-faint">{tr("Open issues")}</h2>
            <IssueList issues={current.issues} />
          </section>
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-faint">{tr("Closures this week")}</h2>
            {current.maintenance.length ? (
              <ul className="space-y-2">
                {current.maintenance.map((m) => (
                  <li key={m.id} className="rounded-2xl border border-line bg-surface p-3 text-sm">
                    <p className="font-semibold text-ink">{m.reason}</p>
                    <p className="text-xs text-muted tabular">
                      {fmtDayShort(m.start)} {fmtTime(m.start)} – {format(new Date(m.end), "EEE HH:mm")} · {m.kind === "planned" ? tr("Planned") : m.kind === "emergency" ? tr("Emergency") : tr("Staff closure")}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl bg-surface-2/70 p-4 text-sm text-muted">{tr("Nothing planned.")}</p>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-faint">{tr("Today at")}{" "}{f.name}</h2>
            <Card className="grid grid-cols-2 gap-4 p-4">
              <Stat label={tr("Utilisation")} value={`${Math.round(current.stats.utilization * 100)}%`} />
              <Stat label={tr("Booked")} value={current.stats.booked} />
              <Stat label={tr("Checked in")} value={current.stats.checkedIn} />
              <Stat label={tr("No-shows")} value={current.stats.noShows} tone={current.stats.noShows ? "danger" : undefined} />
            </Card>
          </section>
        </aside>
      </div>

      <ReportIssueDialog facility={current} open={dialog === "report"} onClose={() => setDialog(null)} />
      <CloseDialog facility={current} open={dialog === "close"} onClose={() => setDialog(null)} />

      <Dialog
        open={pending?.kind === "noshow"}
        onClose={() => setPending(null)}
        size="sm"
        title={tr("Mark as no-show?")}
        description={pending ? `${pending.b.booker.name} · ${fmtRange(pending.b.start, pending.b.end)}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {tr("Cancel")}
            </Button>
            <Button variant="danger" loading={noShow.isPending} onClick={() => pending && noShow.mutate(pending.b.id)}>
              {tr("Mark no-show")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">{tr("The student gets a strike and a notification. Repeated strikes pause their booking access. You can waive it later if there’s a good reason.")}</p>
      </Dialog>

      <Dialog
        open={pending?.kind === "waive"}
        onClose={() => {
          setPending(null);
          setReason("");
        }}
        size="sm"
        title={tr("Waive this strike?")}
        description={pending ? `${pending.b.booker.name} · ${fmtRange(pending.b.start, pending.b.end)}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {tr("Cancel")}
            </Button>
            <Button
              loading={waive.isPending}
              disabled={reason.trim().length < 4}
              onClick={() => {
                if (!pending) return;
                waive.mutate({ id: pending.b.id, reason: reason.trim() }, { onSuccess: () => setReason("") });
              }}
            >
              {tr("Waive strike")}
            </Button>
          </>
        }
      >
        <Field label={tr("Reason")} htmlFor="waive-reason" hint={tr("The student sees this. It’s also kept in the audit log.")}>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {WAIVE_REASONS().map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={cn("h-7 rounded-full border px-2.5 text-xs font-semibold", reason === r ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-muted hover:text-ink")}>
                {r}
              </button>
            ))}
          </div>
          <Textarea id="waive-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16" maxLength={200} />
        </Field>
      </Dialog>

    </div>
  );
}
