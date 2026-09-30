import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { motion } from "motion/react";
import { ArrowRight, Ban, CalendarDays, Clock, Compass, Heart, MapPin, QrCode, Search, ShieldAlert, Sparkles, Ticket } from "lucide-react";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { useCategories, useFacilities, useMyBookings, useMyWaitlist, useStanding } from "@/lib/queries";
import { countdown, dayKey, fmtRange, fmtRelative, fmtTime, greeting, relDay } from "@/lib/time";
import { useSession } from "@/state/session";
import { BRAND_ASSETS } from "@/components/brand/Brand";
import { FacilityArt } from "@/components/facility/FacilityArt";
import { FacilityCard, FacilityCardSkeleton } from "@/components/facility/FacilityCard";
import { useQrSheet, whereLabel } from "@/components/booking/Ticket";
import { StatusBadge } from "@/components/booking/status";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, SectionTitle, Skeleton } from "@/components/ui/Primitives";
import { NotificationBell } from "@/components/shell/Notifications";
import { PushPrompt } from "@/components/shell/PushCard";
import { Invitations } from "@/components/booking/Invitations";
import type { BookingView } from "@/api";
import { L, arCount, currentLanguage, t } from "@/i18n";

function UpNext({ b, more, onQr }: { b: BookingView; more: number; onQr: () => void }) {
  const now = useNow(1000);
  const start = new Date(b.start);
  const ms = start.getTime() - now.getTime();
  const live = b.status === "CHECKED_IN" || (ms <= 0 && new Date(b.end) > now);
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-[26px] border border-line bg-surface shadow-md">
      <div className="relative">
        <FacilityArt motif={b.facility.media.motif} accent={b.facility.media.accent} imageUrl={b.facility.media.imageUrl} className="h-28 w-full sm:h-32" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(0_0_0/0.55),transparent_70%)]" />
        <div className="absolute inset-y-0 start-5 flex flex-col justify-center text-white">
          <p className="text-xs font-bold uppercase tracking-wider text-white/70">{live ? t("Happening now") : t("Up next")}</p>
          <p className="mt-1 font-display text-3xl leading-none">{b.facility.name}</p>
        </div>
        <div className="absolute end-4 top-4">
          <StatusBadge status={b.status} size="xs" className="bg-surface/95" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <p className="flex items-center gap-2 text-[15px] font-bold text-ink tabular">
            <CalendarDays className="size-4 text-muted" />
            {relDay(b.start, now)}{L(", ", "، ")}{fmtRange(b.start, b.end)}
          </p>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <MapPin className="size-4" /> {whereLabel(b)}
          </p>
          {b.status === "AWAITING_PLAYERS" ? (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1 text-xs font-bold text-warning">
              <Clock className="size-3.5" />
              {b.playersDeadline ? t("Waiting for {n} more to accept · until {time}", { n: b.playersNeeded, time: fmtTime(b.playersDeadline) }) : t("Waiting for players")}
            </p>
          ) : (
            !live &&
            ms > 0 && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand-strong">
                <Clock className="size-3.5" />
                {ms < 3 * 3600000 ? <span className="tabular">{t("Starts in")}{" "}{countdown(ms)}</span> : t("Starts {when}", { when: fmtRelative(b.start, now) })}
              </p>
            )
          )}
        </div>
        <div className="flex gap-2">
          {(b.status === "CONFIRMED" || b.status === "CHECKED_IN") && b.relation === "booker" && (
            <Button onClick={onQr} icon={<QrCode className="size-4" />}>
              {t("Show QR")}
            </Button>
          )}
          <Link to={`/bookings/${b.id}`} className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-sm font-semibold text-ink hover:bg-surface-2">
            {t("Details")}
          </Link>
        </div>
      </div>
      {more > 0 && (
        <Link to="/bookings" className="flex items-center justify-between border-t border-line px-5 py-3 text-sm font-semibold text-ink-2 hover:bg-surface-2">
          {L(`${more} more upcoming ${more === 1 ? "booking" : "bookings"}`, `عرض ${more} أخرى`)} <ArrowRight className="size-4" />
        </Link>
      )}
    </motion.div>
  );
}

export function HomePage() {
  const user = useSession((s) => s.user)!;
  const nav = useNavigate();
  const now = useNow(1000);
  const [q, setQ] = useState("");
  const facilities = useFacilities();
  const categories = useCategories();
  const bookings = useMyBookings();
  const waitlist = useMyWaitlist();
  const standing = useStanding();
  const qr = useQrSheet();
  const [cat, setCat] = useState<string>("all");

  const upcoming = useMemo(() => (bookings.data ?? []).filter((b) => b.relation !== "invited" && (b.status === "CONFIRMED" || b.status === "PENDING" || b.status === "AWAITING_PLAYERS" || b.status === "CHECKED_IN") && new Date(b.end) > now).sort((a, b) => a.start.localeCompare(b.start)), [bookings.data, now]);
  const invites = useMemo(() => (bookings.data ?? []).filter((b) => b.relation === "invited" && new Date(b.start) > now), [bookings.data, now]);
  const offer = (waitlist.data ?? []).find((w) => w.entry.status === "offered" && w.entry.offerExpiresAt && new Date(w.entry.offerExpiresAt) > now);
  const railed = (facilities.data ?? []).filter((f) => f.facility.status === "active" && (cat === "all" || f.category.id === cat));
  // Only facilities people have actually booked — a new campus has nothing to rank yet.
  const popular = [...(facilities.data ?? [])].filter((f) => f.facility.status === "active" && f.utilization7d > 0).sort((a, b) => b.utilization7d - a.utilization7d).slice(0, 4);
  const firstName = (currentLanguage() === "ar" && user.nameAr ? user.nameAr : user.name).split(" ")[0];
  const level = standing.data?.standing.level;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    nav(`/explore${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  };

  return (
    <div className="px-4 pt-[max(16px,env(safe-area-inset-top))] sm:px-6 lg:pt-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[30px] bg-dusk text-white shadow-lg">
        <img src={BRAND_ASSETS.campus} alt="" className="absolute inset-0 size-full object-cover opacity-70" />
        <div className="absolute inset-0 bg-[linear-gradient(115deg,rgb(10_17_27/0.92)_10%,rgb(10_17_27/0.55)_60%,rgb(136_91_58/0.35))]" />
        <div className="relative px-5 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-8">
          <div className="flex items-start justify-between">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#e3bb98]">{t("Badya Spaces")}</p>
            <div className="-me-2 -mt-2 lg:hidden">
              <NotificationBell tone="light" />
            </div>
          </div>
          <h1 className="mt-4 font-display text-[40px] leading-[1] sm:text-6xl">
            {greeting(now)}{L(", ", "، ")}{firstName} <span className="not-italic">👋</span>
          </h1>
          <p className="mt-2 text-[15px] text-white/75 sm:text-lg">{t("Find your next activity.")}</p>
          <form onSubmit={submit} className="mt-6 flex max-w-xl items-center gap-2 rounded-2xl bg-white/12 p-1.5 ring-1 ring-white/20 backdrop-blur-md focus-within:ring-white/50" role="search">
            <Search className="ms-2.5 size-5 shrink-0 text-white/70" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search facilities…")} aria-label={t("Search facilities")} className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-white placeholder:text-white/55 outline-none" />
            <button type="submit" className="flex h-11 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-bold text-dusk transition-transform hover:bg-white/90 active:scale-95">
              {t("Search")}
            </button>
          </form>
        </div>
      </section>

      {/* Waitlist offer */}
      {offer && (
        <motion.button
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          onClick={() => nav(`/facility/${offer.facility.id}?day=${dayKey(offer.entry.start)}&claim=${offer.entry.id}`)}
          className="mt-4 flex w-full items-center gap-4 rounded-[22px] bg-brand p-4 text-start text-on-brand shadow-md transition-transform active:scale-[0.99]"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/15">
            <Sparkles className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold">{t("A spot opened on")}{" "}{offer.facility.name}</span>
            <span className="block text-[13px] text-on-brand/80">
              {relDay(offer.entry.start, now)}{L(", ", "، ")}{fmtRange(offer.entry.start, offer.entry.end)}{" "}{t("· held for you")}{" "}<span className="font-bold tabular">{countdown(new Date(offer.entry.offerExpiresAt!).getTime() - now.getTime())}</span>
            </span>
          </span>
          <span className="hidden shrink-0 rounded-xl bg-white px-3.5 py-2 text-sm font-bold text-brand-strong sm:block">{t("Claim")}</span>
          <ArrowRight className="size-5 shrink-0 sm:hidden" />
        </motion.button>
      )}

      <Invitations bookings={invites} />

      <PushPrompt />

      {standing.data?.suspended ? (
        <div role="status" className="mt-4 flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger-soft p-3.5 text-sm">
          <Ban className="mt-0.5 size-5 shrink-0 text-danger" />
          <span className="flex-1 text-ink-2">
            <span className="block font-bold text-ink">{t("Your account is suspended.")}</span>
            {standing.data.suspended.reason && <span className="block">{standing.data.suspended.reason}</span>}
            <span className="mt-0.5 block text-xs text-muted">{t("You can still see and cancel your bookings. Contact the facilities office to book again.")}</span>
          </span>
        </div>
      ) : level && level !== "good" && (
        <Link to="/profile" className={cn("mt-4 flex items-center gap-3 rounded-2xl border p-3.5 text-sm", level === "restricted" ? "border-danger/25 bg-danger-soft" : "border-warning/25 bg-warning-soft")}>
          <ShieldAlert className={cn("size-5 shrink-0", level === "restricted" ? "text-danger" : "text-warning")} />
          <span className="flex-1 text-ink-2">
            {level === "restricted" ? (
              <>
                <span className="font-bold text-ink">{t("Booking is paused.")}</span>{" "}{t("See when you can book again.")}
              </>
            ) : (
              <>
                <span className="font-bold text-ink">{missedOnRecord(standing.data!.standing.strikes.length)}</span>{" "}{t("Check in or cancel in time to keep booking.")}
              </>
            )}
          </span>
          <ArrowRight className="size-4 text-muted" />
        </Link>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Up next */}
        <section aria-labelledby="upnext">
          <SectionTitle title={<span id="upnext">{t("Your next booking")}</span>} action={<Link to="/bookings" className="text-sm font-semibold text-brand hover:underline">{t("All bookings")}</Link>} />
          {bookings.isError ? (
            <ErrorState compact error={bookings.error} onRetry={() => bookings.refetch()} />
          ) : !bookings.data ? (
            <Skeleton className="h-64 rounded-[26px]" />
          ) : upcoming.length ? (
            <UpNext b={upcoming[0]} more={upcoming.length - 1} onQr={() => qr.open(upcoming[0])} />
          ) : (
            <div className="rounded-[26px] border border-dashed border-line-strong bg-surface/60">
              <EmptyState compact icon={Ticket} title={t("You don’t have any upcoming bookings")} body={t("Courts, pitches and Activity Center tables — most have sessions free today.")} action={<Button onClick={() => nav("/explore")} icon={<Compass className="size-4" />}>{t("Explore facilities")}</Button>} />
            </div>
          )}
        </section>

        {/* Quick actions */}
        <section aria-labelledby="quick">
          <SectionTitle title={<span id="quick">{t("Quick actions")}</span>} />
          <div className="grid grid-cols-2 gap-3">
            {[
              { to: "/explore", label: t("Book a facility"), sub: t("See what’s free"), icon: Compass, accent: true },
              { to: "/bookings", label: t("My bookings"), sub: t("{n} upcoming", { n: upcoming.length }), icon: Ticket },
              { to: "/calendar", label: t("Calendar"), sub: t("Your week at a glance"), icon: CalendarDays },
              { to: "/favorites", label: t("Favorites"), sub: t("{n} saved", { n: (facilities.data ?? []).filter((f) => f.isFavorite).length }), icon: Heart },
            ].map((a, i) => (
              <motion.div key={a.to} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}>
                <Link to={a.to} className={cn("group flex h-full flex-col justify-between gap-6 rounded-[22px] border p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md", a.accent ? "border-transparent bg-brand text-on-brand" : "border-line bg-surface text-ink")}>
                  <span className={cn("flex size-10 items-center justify-center rounded-2xl", a.accent ? "bg-white/15" : "bg-brand-soft text-brand")}>
                    <a.icon className="size-5" />
                  </span>
                  <span>
                    <span className="block text-[15px] font-bold">{a.label}</span>
                    <span className={cn("block text-xs", a.accent ? "text-on-brand/75" : "text-muted")}>{a.sub}</span>
                  </span>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>
      </div>

      {/* Explore rail */}
      <section className="mt-10" aria-labelledby="explore">
        <SectionTitle title={<span id="explore">{t("Explore facilities")}</span>} action={<Link to="/explore" className="text-sm font-semibold text-brand hover:underline">{t("See all")}</Link>} />
        <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {[{ id: "all", name: t("All") }, ...(categories.data ?? [])].map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)} className={cn("relative h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors", cat === c.id ? "text-on-brand" : "border border-line bg-surface text-ink-2 hover:border-line-strong")}>
              {cat === c.id && <motion.span layoutId="home-cat" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
              <span className={cn("relative", cat === c.id && "text-bg")}>{c.name}</span>
            </button>
          ))}
        </div>
        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
          {facilities.isError ? (
            <ErrorState compact error={facilities.error} onRetry={() => facilities.refetch()} className="w-full" />
          ) : !facilities.data ? (
            Array.from({ length: 4 }, (_, i) => <FacilityCardSkeleton key={i} variant="rail" />)
          ) : (
            railed.map((f) => <FacilityCard key={f.facility.id} s={f} variant="rail" />)
          )}
        </div>
      </section>

      {/* Popular */}
      {(!facilities.data || popular.length > 0) && (
        <section className="mt-6" aria-labelledby="popular">
          <SectionTitle title={<span id="popular">{t("Popular this week")}</span>} subtitle={t("Most-booked facilities — book early to get the time you want.")} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!facilities.data ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[88px]" />) : popular.map((f) => <FacilityCard key={f.facility.id} s={f} variant="row" />)}
          </div>
        </section>
      )}
      {qr.sheet}
    </div>
  );
}

const missedOnRecord = (n: number) => L(`${n} missed ${n === 1 ? "session" : "sessions"} on record.`, `مسجّل عليك ${arCount(n, "موعد واحد فائت", "موعدان فائتان", "مواعيد فائتة", "موعدًا فائتًا")}.`);
