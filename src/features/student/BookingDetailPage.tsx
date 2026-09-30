import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CalendarPlus, Check, Clock, Info, MapPin, QrCode as QrIcon, UserPlus, X } from "lucide-react";
import { api, ApiError } from "@/api";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { useBooking } from "@/lib/queries";
import { downloadIcs } from "@/lib/ics";
import { fmtDateTime, fmtDayLong, fmtRange, fmtRelative, fmtTime, format } from "@/lib/time";
import { POLICY_ICONS } from "@/components/icons";
import { FacilityArt } from "@/components/facility/FacilityArt";
import { BOOKING_STATUS, StatusBadge } from "@/components/booking/status";
import { LiveQr } from "@/components/booking/Ticket";
import { TeamCard } from "@/components/booking/Team";
import { useRespond } from "@/components/booking/Invitations";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { Dialog } from "@/components/ui/Overlay";
import { toast } from "@/components/ui/Toast";
import { L, arCount, t } from "@/i18n";

const REASONS = () => [t("Plans changed"), t("Class or exam clash"), t("Not feeling well"), t("Teammates can’t make it"), t("Booked by mistake")];

export function BookingDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useBooking(id);
  const now = useNow(1000);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const respond = useRespond(id);
  const leave = useMutation({
    mutationFn: () => api.bookings.leave(id),
    onSuccess: () => {
      qc.invalidateQueries();
      setLeaveOpen(false);
      toast.success(t("You left the booking"), t("It no longer counts towards your limits."));
      nav("/bookings", { replace: true });
    },
    onError: (e) => toast.error(t("Couldn’t leave the booking"), e instanceof ApiError ? e.message : undefined),
  });
  const [reason, setReason] = useState(() => REASONS()[0]);
  const cancel = useMutation({
    mutationFn: () => api.bookings.cancel(id, reason),
    onSuccess: (r) => {
      qc.invalidateQueries();
      setCancelOpen(false);
      toast.success(t("Booking cancelled"), r.offeredToNext ? t("Your spot was offered to the next student on the waitlist. Thank you!") : r.booking.cancellation?.penalty ? t("This late cancellation was recorded as a strike.") : t("No strike recorded."));
    },
    onError: (e) => toast.error(t("Couldn’t cancel"), e instanceof ApiError ? e.message : undefined),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div className="space-y-4 px-4 pt-6 sm:px-6">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-72 rounded-[28px]" />
        <Skeleton className="h-40 rounded-[28px]" />
      </div>
    );

  const b = q.data;
  const f = b.facility;
  const meta = BOOKING_STATUS[b.status];
  const start = new Date(b.start);
  const showQr = (b.status === "CONFIRMED" || b.status === "CHECKED_IN") && b.relation === "booker";
  const opens = new Date(b.checkInWindow.opens);
  const closes = new Date(b.checkInWindow.closes);
  const windowOpen = now >= opens && now <= closes;

  return (
    <div className="px-4 pt-[max(16px,env(safe-area-inset-top))] sm:px-6 lg:pt-8">
      <div className="mb-4 flex items-center gap-2">
        <IconButton label={t("Back")} variant="secondary" onClick={() => (window.history.length > 1 ? nav(-1) : nav("/bookings"))}>
          <ArrowLeft className="size-5" />
        </IconButton>
        <p className="font-mono text-xs font-semibold text-muted">{b.id}</p>
      </div>

      {b.relation === "invited" && start > now && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[22px] border border-brand/30 bg-brand-softer p-4">
          <UserPlus className="size-5 shrink-0 text-brand" />
          <p className="min-w-0 flex-1 text-sm text-ink-2">
            <span className="font-bold text-ink">{t("{name} invited you to play.", { name: b.booker.name })}</span>{" "}
            {t("Accept to join — it then counts towards your own limits. If you can’t make it, decline so they can invite someone else.")}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" icon={<X className="size-4" />} disabled={respond.isPending} loading={respond.isPending && respond.variables === "decline"} onClick={() => respond.mutate("decline")}>
              {t("Decline")}
            </Button>
            <Button size="sm" icon={<Check className="size-4" />} disabled={respond.isPending} loading={respond.isPending && respond.variables === "accept"} onClick={() => respond.mutate("accept")}>
              {t("Accept")}
            </Button>
          </div>
        </div>
      )}
      {b.status === "AWAITING_PLAYERS" && b.playersDeadline && (
        <div className="mb-5 flex gap-3 rounded-[22px] border border-warning/30 bg-warning-soft p-4 text-sm">
          <Clock className="mt-0.5 size-5 shrink-0 text-warning" />
          <p className="text-ink-2">
            <span className="font-bold text-ink">{t("Acceptances still needed: {n} — until {time}.", { n: b.playersNeeded, time: format(new Date(b.playersDeadline), "EEE HH:mm") })}</span>{" "}
            {t("The session is held for you until then. If too few accept, the booking is cancelled without a strike and the session reopens for others.")}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="relative">
              <FacilityArt motif={f.media.motif} accent={f.media.accent} imageUrl={f.media.imageUrl} className="h-36 w-full" />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(0_0_0/0.6),transparent)]" />
              <div className="absolute inset-y-0 start-5 flex flex-col justify-center text-white">
                <p className="text-xs font-semibold uppercase tracking-wider text-white/70">{b.category.name}</p>
                <h1 className="font-display text-4xl leading-none">{f.name}</h1>
              </div>
            </div>
            <div className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={b.status} />
                {b.relation === "participant" && <span className="text-xs text-muted">{t("You’re a participant — booked by")}{" "}{b.booker.name}</span>}
              </div>
              <p className="mt-3 text-sm text-muted">{meta.description}</p>
              <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex gap-3">
                  <Clock className="mt-0.5 size-5 text-muted" />
                  <div>
                    <dt className="text-xs font-semibold text-muted">{t("When")}</dt>
                    <dd className="text-[15px] font-bold text-ink">{fmtDayLong(b.start)}</dd>
                    <dd className="text-sm text-ink-2 tabular">
                      {fmtRange(b.start, b.end)} · {f.sessionMinutes}{" "}{t("min")}{b.status === "CONFIRMED" && start > now ? ` · ${t("starts {when}", { when: fmtRelative(b.start, now) })}` : ""}
                    </dd>
                  </div>
                </div>
                <div className="flex gap-3">
                  <MapPin className="mt-0.5 size-5 text-muted" />
                  <div>
                    <dt className="text-xs font-semibold text-muted">{t("Where")}</dt>
                    <dd className="text-[15px] font-bold text-ink">{b.unitName ?? f.location.building}</dd>
                    <dd className="text-sm text-ink-2">{[b.unitName ? f.location.building : null, f.location.floor ?? f.location.area].filter(Boolean).join(" · ")}</dd>
                    <dd>
                      <Link to={`/facility/${f.id}#location`} className="text-xs font-bold text-brand hover:underline">
                        {t("Show on campus map")}
                      </Link>
                    </dd>
                  </div>
                </div>
              </dl>
              {b.purpose && (
                <p className="mt-4 rounded-xl bg-surface-2 p-3 text-sm text-ink-2">
                  <span className="font-semibold text-ink">{t("Purpose:")}{" "}</span>
                  {b.purpose}
                </p>
              )}
            </div>
          </Card>

          <TeamCard b={b} />

          <Card className="p-5">
            <h2 className="text-base font-bold text-ink">{t("Timeline")}</h2>
            <ol className="relative mt-4 space-y-4 ps-6">
              <span className="absolute bottom-2 start-[7px] top-2 w-px bg-line" aria-hidden />
              {b.events.map((e, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="relative">
                  <span className={cn("absolute -start-6 top-1 size-[15px] rounded-full border-[3px] border-surface", e.tone === "success" ? "bg-success" : e.tone === "danger" ? "bg-danger" : e.tone === "warning" ? "bg-warning" : e.tone === "info" ? "bg-info" : "bg-faint")} />
                  <p className="text-sm font-semibold text-ink">{e.label}</p>
                  <p className="text-xs text-muted">
                    {fmtDateTime(e.at)}
                    {e.detail && ` · ${e.detail}`}
                  </p>
                </motion.li>
              ))}
              {b.status === "CONFIRMED" && start > now && (
                <li className="relative">
                  <span className="absolute -start-6 top-1 size-[15px] rounded-full border-2 border-dashed border-line-strong bg-surface" />
                  <p className="text-sm font-semibold text-muted">{t("Check-in opens")}{" "}{format(opens, "EEE HH:mm")}</p>
                  <p className="text-xs text-faint">{t("Closes")}{" "}{fmtTime(closes)}{" "}{t("— after that the booking becomes a no-show")}</p>
                </li>
              )}
            </ol>
          </Card>

          <Card className="p-5">
            <h2 className="text-base font-bold text-ink">{t("Rules for this booking")}</h2>
            <ul className="mt-3 space-y-2">
              {b.policyLines.map((l) => {
                const I = POLICY_ICONS[l.icon] ?? Info;
                return (
                  <li key={l.text} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
                    <I className="mt-0.5 size-4 shrink-0 text-muted" /> {l.text}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {showQr ? (
            <Card className="flex flex-col items-center p-6">
              <p className="mb-1 flex items-center gap-2 text-sm font-bold text-ink">
                <QrIcon className="size-4 text-brand" />{" "}{t("Check-in code")}
              </p>
              <p className={cn("mb-5 text-center text-xs", windowOpen ? "font-semibold text-success" : "text-muted")}>{windowOpen ? t("Check-in is open now — show this at the entrance.") : now < opens ? t("Check-in opens at {time}", { time: fmtTime(opens) }) : b.status === "CHECKED_IN" ? t("Checked in at {time}", { time: fmtTime(b.checkIn!.at) }) : t("Check-in has closed")}</p>
              <LiveQr bookingId={b.id} size={210} />
            </Card>
          ) : b.status === "PENDING" ? (
            <Card className="p-5">
              <p className="text-sm font-bold text-ink">{t("Waiting for approval")}</p>
              <p className="mt-1 text-sm text-muted">{t("Your QR code will appear here once staff approve the request.")}</p>
            </Card>
          ) : b.status === "AWAITING_PLAYERS" && b.relation === "booker" ? (
            <Card className="p-5">
              <p className="text-sm font-bold text-ink">{t("Waiting for your players")}</p>
              <p className="mt-1 text-sm text-muted">{t("Your QR code will appear here once enough players accept.")}</p>
            </Card>
          ) : null}

          <Card className="space-y-2 p-4">
            {(b.status === "CONFIRMED" || b.status === "PENDING" || b.status === "AWAITING_PLAYERS") && b.relation !== "invited" && (
              <Button variant="secondary" block icon={<CalendarPlus className="size-4" />} onClick={() => downloadIcs(b)}>
                {t("Add to calendar")}
              </Button>
            )}
            {b.cancel.allowed && b.relation === "booker" && (
              <Button variant="danger-soft" block onClick={() => setCancelOpen(true)}>
                {t("Cancel booking")}
              </Button>
            )}
            {b.relation === "participant" && (b.status === "CONFIRMED" || b.status === "PENDING" || b.status === "AWAITING_PLAYERS") && start > now && (
              <Button variant="danger-soft" block onClick={() => setLeaveOpen(true)}>
                {t("Remove me from this booking")}
              </Button>
            )}
            <Button variant="ghost" block onClick={() => nav(`/facility/${f.id}`)}>
              {t("Book")}{" "}{f.name}{" "}{t("again")}
            </Button>
            {b.cancel.allowed && b.relation === "booker" && (
              <p className="px-1 pt-1 text-center text-xs text-muted">
                {b.cancel.late ? <span className="font-semibold text-warning">{t("Free cancellation has ended")}</span> : <>{t("Free cancellation until")}{" "}{format(new Date(b.cancel.freeUntil), "EEE d MMM, HH:mm")}</>}
              </p>
            )}
            {b.waitlistCount > 0 && b.cancel.allowed && <p className="px-1 text-center text-xs text-muted">{L(`${b.waitlistCount} ${b.waitlistCount === 1 ? "student is" : "students are"} waiting for this session.`, `${arCount(b.waitlistCount, "طالب واحد ينتظر", "طالبان ينتظران", "طلاب ينتظرون", "طالبًا ينتظرون")} هذا الموعد.`)}</p>}
          </Card>
        </div>
      </div>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t("Cancel this booking?")}
        description={`${f.name} · ${fmtDayLong(b.start)}${L(", ", "، ")}${fmtRange(b.start, b.end)}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              {t("Keep booking")}
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              {b.cancel.penalty ? t("Cancel anyway") : t("Yes, cancel")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {b.cancel.late ? (
            <div className={cn("flex gap-3 rounded-2xl p-3.5 text-sm", b.cancel.penalty ? "bg-danger-soft" : "bg-warning-soft")}>
              <AlertTriangle className={cn("mt-0.5 size-5 shrink-0", b.cancel.penalty ? "text-danger" : "text-warning")} />
              <p className="text-ink-2">
                <span className="font-bold text-ink">{t("This is a late cancellation.")}</span> {b.cancel.penalty ? t("It will count as a missed session (a strike) on your record until it expires.") : t("It won’t count as a strike, but repeated late cancellations are reviewed.")}
              </p>
            </div>
          ) : (
            <div className="flex gap-3 rounded-2xl bg-success-soft p-3.5 text-sm">
              <Check className="mt-0.5 size-5 shrink-0 text-success" />
              <p className="text-ink-2">
                <span className="font-bold text-ink">{t("Free cancellation.")}</span>{" "}{b.waitlistCount > 0 ? t("No strike will be recorded, and your spot goes straight to the next student on the waitlist.") : t("No strike will be recorded.")}
              </p>
            </div>
          )}
          {b.people.length > 0 && <p className="text-sm text-muted">{t("The")}{" "}{b.people.length}{" "}{t("other people on this booking will be notified.")}</p>}
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink">{t("Reason (helps us plan)")}</legend>
            <div className="flex flex-wrap gap-2">
              {REASONS().map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r} className={cn("h-8 rounded-full border px-3 text-xs font-semibold", reason === r ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-ink-2")}>
                  {r}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </Dialog>

      <Dialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        size="sm"
        title={t("Remove yourself from this booking?")}
        description={t("It will stop counting towards your limits. If that leaves {name} short of players, the booking goes back on hold until they invite someone else — or it’s cancelled.", { name: b.booker.name })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLeaveOpen(false)}>
              {t("Keep me on it")}
            </Button>
            <Button variant="danger" loading={leave.isPending} onClick={() => leave.mutate()}>
              {t("Remove me")}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </div>
  );
}
