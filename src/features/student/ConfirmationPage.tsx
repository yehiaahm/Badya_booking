import { Link, useLocation, useNavigate, useParams } from "react-router";
import { motion } from "motion/react";
import { Bell, CalendarPlus, Check, Clock, Hourglass, MapPin, QrCode as QrIcon, ShieldCheck, Undo2, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useBooking } from "@/lib/queries";
import { downloadIcs } from "@/lib/ics";
import { fmtDayLong, fmtRange, fmtTime, format } from "@/lib/time";
import { useSession } from "@/state/session";
import { FacilityArt } from "@/components/facility/FacilityArt";
import { Button } from "@/components/ui/Button";
import { AvatarStack, Card, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { fmtMinutes } from "@/domain/policy";
import { N, t } from "@/i18n";

const BURST = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2;
  return { x: Math.cos(a) * (70 + (i % 3) * 18), y: Math.sin(a) * (70 + (i % 3) * 18), c: ["var(--brand)", "var(--success)", "var(--warning)", "var(--info)", "var(--violet)"][i % 5], d: i * 0.012 };
});

function Seal({ pending }: { pending: boolean }) {
  return (
    <div className="relative mx-auto flex size-24 items-center justify-center">
      {!pending &&
        BURST.map((p, i) => (
          <motion.span key={i} className="absolute size-2 rounded-full" style={{ background: p.c }} initial={{ x: 0, y: 0, opacity: 0, scale: 0 }} animate={{ x: p.x, y: p.y, opacity: [0, 1, 0], scale: [0, 1, 0.6] }} transition={{ duration: 0.9, delay: 0.25 + p.d, ease: "easeOut" }} aria-hidden />
        ))}
      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }} className={cn("flex size-24 items-center justify-center rounded-full", pending ? "bg-warning-soft text-warning" : "bg-success text-white shadow-lg")}>
        {pending ? (
          <Hourglass className="size-10" />
        ) : (
          <svg viewBox="0 0 24 24" className="size-11" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.2, duration: 0.4, ease: "easeOut" }} />
          </svg>
        )}
      </motion.span>
    </div>
  );
}

export function ConfirmationPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const flagged = !!(useLocation().state as { flagged?: boolean } | null)?.flagged;
  const reminder = useSession((s) => s.user?.preferences?.reminderMinutes ?? 60);
  const q = useBooking(id);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} className="mt-10" />;
  if (!q.data)
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 pt-12">
        <Skeleton className="mx-auto size-24 rounded-full" />
        <Skeleton className="mx-auto h-8 w-2/3" />
        <Skeleton className="h-64 rounded-[28px]" />
      </div>
    );

  const b = q.data;
  const f = b.facility;
  const awaiting = b.status === "AWAITING_PLAYERS";
  const pending = b.status === "PENDING" || awaiting;
  const opens = new Date(b.checkInWindow.opens);
  const closes = new Date(b.checkInWindow.closes);
  const deadline = b.playersDeadline ? format(new Date(b.playersDeadline), "EEE HH:mm") : "";

  const steps = awaiting
    ? [
        { icon: Users, title: t("Your players accept on their phones"), body: t("Each of them got an invitation. Nothing counts towards their limits until they accept.") },
        { icon: Hourglass, title: t("Acceptances still needed: {n} — by {time}", { n: b.playersNeeded, time: deadline }), body: t("If too few accept in time, the booking is cancelled without a strike and the session reopens for others.") },
        { icon: QrIcon, title: t("Your QR code appears once it’s confirmed"), body: t("Show it at the entrance to check in.") },
      ]
    : pending
    ? [
        { icon: Hourglass, title: t("Staff review your request"), body: t("Most requests are answered within a working day. We’ll notify you either way.") },
        { icon: QrIcon, title: t("Your QR code appears once approved"), body: t("Show it at the entrance to check in.") },
        { icon: Undo2, title: t("Changed your mind?"), body: t("You can withdraw the request any time before it’s approved.") },
      ]
    : [
        { icon: Bell, title: t("We’ll remind you {when} before", { when: fmtMinutes(reminder) }), body: t("You can change this in your profile.") },
        { icon: QrIcon, title: t("Check in between {from} and {to}", { from: fmtTime(opens), to: fmtTime(closes) }), body: t("Show your QR code at the entrance. After that the booking becomes a no-show and counts as a strike.") },
        { icon: Undo2, title: b.cancel.late ? t("Cancelling now counts as late") : t("Free cancellation until {when}", { when: format(new Date(b.cancel.freeUntil), "EEE HH:mm") }), body: b.cancel.late ? t("If you can’t make it, cancel anyway — it frees the spot for someone on the waitlist.") : t("Can’t make it? Cancel before then and your spot goes to the next student.") },
      ];

  return (
    <div className="mx-auto max-w-xl px-4 pb-10 pt-[max(40px,env(safe-area-inset-top))] sm:px-6 lg:pt-14">
      <Seal pending={pending} />
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mt-6 text-center">
        <h1 className="font-display text-[38px] leading-none text-ink">{awaiting ? t("Invitations sent") : pending ? t("Request sent") : t("You’re booked!")}</h1>
        <p className="mt-2 text-sm text-muted">{awaiting ? t("{name} is held for you while your players accept.", { name: f.name }) : pending ? t("{name} needs staff approval. We’ll let you know as soon as it’s reviewed.", { name: f.name }) : t("See you at {name}. Your booking is confirmed.", { name: f.name })}</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
        <Card className="mt-7 overflow-hidden">
          <div className="flex items-center gap-4 p-5">
            <FacilityArt motif={f.media.motif} accent={f.media.accent} imageUrl={f.media.imageUrl} className="size-16 shrink-0 rounded-2xl" />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">{b.category.name}</p>
              <h2 className="truncate text-lg font-bold text-ink">{f.name}</h2>
              <p className="font-mono text-[11px] text-faint">{b.id}</p>
            </div>
          </div>
          <div className="relative border-t-2 border-dashed border-line" aria-hidden>
            <span className="absolute -start-2.5 -top-2.5 size-5 rounded-full bg-bg" />
            <span className="absolute -end-2.5 -top-2.5 size-5 rounded-full bg-bg" />
          </div>
          <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <div className="flex gap-3">
              <Clock className="mt-0.5 size-5 shrink-0 text-muted" />
              <div>
                <dt className="sr-only">{t("When")}</dt>
                <dd className="text-[15px] font-bold text-ink">{fmtDayLong(b.start)}</dd>
                <dd className="text-sm text-ink-2 tabular">{fmtRange(b.start, b.end)}</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <MapPin className="mt-0.5 size-5 shrink-0 text-muted" />
              <div className="min-w-0">
                <dt className="sr-only">{t("Where")}</dt>
                <dd className="text-[15px] font-bold text-ink">{b.unitName ?? f.location.building}</dd>
                <dd className="truncate text-sm text-ink-2">{[b.unitName ? f.location.building : null, f.location.floor ?? f.location.area].filter(Boolean).join(" · ")}</dd>
              </div>
            </div>
            {b.team.length > 0 && (
              <div className="flex items-center gap-3 sm:col-span-2">
                <Users className="size-5 shrink-0 text-muted" />
                <dt className="sr-only">{t("With")}</dt>
                <AvatarStack people={[b.booker, ...b.team.map((p) => p.user)]} size={26} max={6} />
                <dd className="text-sm text-ink-2">
                  {t("{people} invited — each accepts from their own phone.", { people: N.person(b.team.length) })}
                </dd>
              </div>
            )}
          </dl>
        </Card>
      </motion.div>

      {flagged && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }} className="mt-4 flex gap-3 rounded-2xl bg-info-soft p-4 text-sm">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-info" />
          <p className="text-ink-2">
            <span className="font-bold text-ink">{t("Routine fair-use check.")}</span>{" "}{t("This booking is part of a pattern our system asks staff to glance at, so everyone gets a fair turn. Your booking stands — there’s nothing you need to do.")}
          </p>
        </motion.div>
      )}

      <motion.ol initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.07, delayChildren: 0.55 } } }} className="mt-7 space-y-4">
        {steps.map((s) => (
          <motion.li key={s.title} variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } }} className="flex gap-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
              <s.icon className="size-[18px]" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink">{s.title}</p>
              <p className="text-[13px] leading-relaxed text-muted">{s.body}</p>
            </div>
          </motion.li>
        ))}
      </motion.ol>

      <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button size="lg" onClick={() => nav(`/bookings/${b.id}`, { replace: true })} icon={pending ? <Check className="size-4" /> : <QrIcon className="size-4" />}>
          {awaiting ? t("View booking") : pending ? t("View request") : t("View booking & QR")}
        </Button>
        <Button size="lg" variant="secondary" onClick={() => downloadIcs(b)} icon={<CalendarPlus className="size-4" />}>
          {t("Add to calendar")}
        </Button>
      </div>
      <p className="mt-5 text-center text-sm">
        <Link to="/explore" replace className="font-semibold text-brand hover:underline">
          {t("Book something else")}
        </Link>
        <span className="mx-2 text-faint">·</span>
        <Link to="/home" replace className="font-semibold text-muted hover:text-ink">
          {t("Back to home")}
        </Link>
      </p>
    </div>
  );
}
