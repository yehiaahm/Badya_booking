import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, CalendarCheck, Clock3, Hourglass, Info, MapPin, Scale, Share2, Timer, Users, Wrench } from "lucide-react";
import type { SlotView } from "@/api";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/hooks";
import { useAvailability, useFacility, useMyWaitlist } from "@/lib/queries";
import { clock, dayKey, fmtDayLong, fmtDayShort, fmtRange, fmtTime, format, relDay } from "@/lib/time";
import { fmtMinutes } from "@/domain/policy";
import { AMENITIES, POLICY_ICONS } from "@/components/icons";
import { BRAND_ASSETS } from "@/components/brand/Brand";
import { FacilityArt } from "@/components/facility/FacilityArt";
import { FavoriteButton, capacityLabel, locationLabel } from "@/components/facility/FacilityCard";
import { DateStrip, SlotGrid, SlotGridSkeleton, SlotLegend } from "@/components/booking/Availability";
import { BookingSheet, type BookingMode } from "@/components/booking/BookingSheet";
import { SlotInfoSheet } from "@/components/booking/SlotInfoSheet";
import { ColumnChart } from "@/components/charts/Charts";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { toast } from "@/components/ui/Toast";
import { L, N, t, tStored } from "@/i18n";

function Fact({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
        <span className="block truncate text-sm font-bold text-ink">{value}</span>
      </span>
    </div>
  );
}

export function FacilityPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const desktop = useIsDesktop();
  const detail = useFacility(id);
  const today = dayKey(clock.now());
  const day = params.get("day") ?? today;
  const avail = useAvailability(id, day);
  const waitlist = useMyWaitlist();
  const [selected, setSelected] = useState<string | null>(params.get("slot"));
  const [info, setInfo] = useState<SlotView | null>(null);
  const [sheet, setSheet] = useState<{ start: string; end: string; mode: BookingMode } | null>(null);

  // Claim flow: /facility/:id?claim=<waitlistEntryId>
  const claimId = params.get("claim");
  useEffect(() => {
    if (!claimId || !waitlist.data || !detail.data) return;
    const w = waitlist.data.find((x) => x.entry.id === claimId && x.entry.status === "offered");
    if (w && w.entry.offerExpiresAt) setSheet({ start: w.entry.start, end: w.entry.end, mode: { kind: "claim", entryId: w.entry.id, expiresAt: w.entry.offerExpiresAt } });
    const next = new URLSearchParams(params);
    next.delete("claim");
    setParams(next, { replace: true });
  }, [claimId, waitlist.data, detail.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the selection valid as availability changes.
  const selectedSlot = useMemo(() => avail.data?.slots.find((s) => s.session.start === selected && (s.status === "available" || s.status === "limited")), [avail.data, selected]);
  useEffect(() => {
    if (selected && avail.data && !avail.isPlaceholderData && !selectedSlot) setSelected(null);
  }, [avail.data, avail.isPlaceholderData, selected, selectedSlot]);

  const setDay = (d: string) => {
    const next = new URLSearchParams(params);
    next.set("day", d);
    next.delete("slot");
    setParams(next, { replace: true });
    setSelected(null);
  };

  const pick = (s: SlotView) => {
    if (s.status === "available" || s.status === "limited") {
      setSelected((cur) => (cur === s.session.start ? null : s.session.start));
      return;
    }
    if (s.status === "mine" && s.bookingId) {
      nav(`/bookings/${s.bookingId}`);
      return;
    }
    if (s.status === "past") return;
    setInfo(s);
  };

  const suggestion = useMemo(() => {
    if (!info || !avail.data) return undefined;
    return avail.data.slots.find((s) => (s.status === "available" || s.status === "limited") && s.session.start > info.session.start) ?? avail.data.slots.find((s) => s.status === "available" || s.status === "limited");
  }, [info, avail.data]);

  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  if (!detail.data) return <FacilitySkeleton />;

  const d = detail.data;
  const f = d.facility;
  const inactive = f.status !== "active";
  const hoursToday = d.today.hours;
  const fairLines = d.policyLines.filter((l) => l.tone === "fair");
  const otherLines = d.policyLines.filter((l) => l.tone !== "fair");
  const nowHour = clock.now().getHours();
  const popular = d.popularTimes.map((v, h) => ({ h, v })).filter(({ h }) => d.facility.schedule.some((s) => s && Number(s.open.slice(0, 2)) <= h && Number(s.close.slice(0, 2)) > h));
  const bookable = avail.data?.slots.filter((s) => s.status === "available" || s.status === "limited").length ?? 0;

  const openBooking = () => selectedSlot && setSheet({ start: selectedSlot.session.start, end: selectedSlot.session.end, mode: { kind: "book" } });

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: f.name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success(t("Link copied"), t("Share it with your teammates."));
      }
    } catch {
      /* dismissed */
    }
  };

  const selectionPanel = (
    <Card className="p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-faint">{t("Your selection")}</p>
      <AnimatePresence mode="wait" initial={false}>
        {selectedSlot ? (
          <motion.div key={selectedSlot.session.start} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            <p className="mt-2 font-display text-3xl text-ink">{fmtRange(selectedSlot.session.start, selectedSlot.session.end)}</p>
            <p className="text-sm font-semibold text-ink-2">{fmtDayLong(selectedSlot.session.start)}</p>
            <p className="mt-1 text-xs text-muted">
              {selectedSlot.session.capacity > 1 ? L(`${selectedSlot.session.remaining} of ${selectedSlot.session.capacity} ${f.mode === "exclusive" ? f.unitLabel + "s" : "spots"} free`, `متاح ${selectedSlot.session.remaining} من ${selectedSlot.session.capacity}`) : t("Whole facility")} · {f.sessionMinutes}{" "}{t("min")}
            </p>
          </motion.div>
        ) : (
          <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t("Pick an available session to see the details here.")}</p>
          </motion.div>
        )}
      </AnimatePresence>
      <Button size="lg" block className="mt-4" disabled={!selectedSlot} onClick={openBooking}>
        {d.policy.approval.required ? t("Request booking") : t("Book now")}
      </Button>
      <ul className="mt-5 space-y-2.5 border-t border-line pt-4">
        {fairLines.slice(0, 3).map((l) => {
          const I = POLICY_ICONS[l.icon] ?? Info;
          return (
            <li key={l.text} className="flex gap-2.5 text-xs leading-relaxed text-ink-2">
              <I className="mt-0.5 size-3.5 shrink-0 text-brand" /> {l.text}
            </li>
          );
        })}
      </ul>
    </Card>
  );

  return (
    <div className="pb-32 lg:pb-0">
      {/* Hero */}
      <div className="relative lg:mx-6 lg:mt-6">
        <FacilityArt motif={f.media.motif} accent={f.media.accent} imageUrl={f.media.imageUrl} className="h-[300px] w-full sm:h-[360px] lg:h-[380px] lg:rounded-[28px]" alt={t("{name} plan view", { name: f.name })} dim={inactive} />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.3),transparent_35%,transparent_60%,rgb(0_0_0/0.45))] lg:rounded-[28px]" />
        <div className="absolute inset-x-4 top-[max(16px,env(safe-area-inset-top))] flex items-center justify-between sm:inset-x-6">
          <IconButton label={t("Back")} variant="glass" onClick={() => (window.history.length > 1 ? nav(-1) : nav("/explore"))}>
            <ArrowLeft className="size-5" />
          </IconButton>
          <div className="flex gap-2">
            <IconButton label={t("Share")} variant="glass" onClick={share}>
              <Share2 className="size-[18px]" />
            </IconButton>
            <FavoriteButton facilityId={f.id} active={d.isFavorite} name={f.name} className="size-10" />
          </div>
        </div>
        <div className="absolute bottom-10 start-4 end-4 hidden sm:start-6 lg:bottom-8 lg:start-8 lg:block">
          <Badge tone="dusk" className="bg-black/40 backdrop-blur">
            {d.category.name}
          </Badge>
          <h1 className="mt-3 font-display text-6xl leading-none text-white drop-shadow-sm">{f.name}</h1>
          {f.nameAr && f.nameAr !== f.name && (
            <p lang="ar" dir="rtl" className="mt-2 text-lg text-white/75">
              {f.nameAr}
            </p>
          )}
        </div>
      </div>

      <div className="relative -mt-6 rounded-t-[28px] bg-bg px-4 pt-6 sm:px-6 lg:mt-0 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:rounded-none lg:bg-transparent lg:pt-8">
        <div className="min-w-0">
          {/* Title (mobile) */}
          <div className="lg:hidden">
            <Badge tone="brand">{d.category.name}</Badge>
            <h1 className="mt-2.5 font-display text-[40px] leading-[1] text-ink">{f.name}</h1>
            {f.nameAr && f.nameAr !== f.name && (
              <p lang="ar" dir="rtl" className="mt-1.5 text-end text-base text-muted">
                {f.nameAr}
              </p>
            )}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-2 lg:mt-0">
            <MapPin className="size-4 text-muted" /> {locationLabel(f)}
            <a href="#location" className="ms-1 text-xs font-bold text-brand hover:underline">
              {t("Map")}
            </a>
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact icon={Users} label={t("Capacity")} value={capacityLabel(f)} />
            <Fact icon={Timer} label={t("Session")} value={fmtMinutes(f.sessionMinutes)} />
            <Fact icon={Clock3} label={t("Today")} value={hoursToday ? `${hoursToday.open}–${hoursToday.close}` : "Closed"} />
            <Fact icon={Hourglass} label={t("Turnover")} value={f.turnoverMinutes ? fmtMinutes(f.turnoverMinutes) : t("None")} />
          </div>

          {inactive && (
            <div className="mt-5 flex gap-3 rounded-2xl border border-danger/20 bg-danger-soft p-4">
              <Info className="mt-0.5 size-5 shrink-0 text-danger" />
              <div>
                <p className="text-sm font-bold text-danger">{t("Temporarily closed")}</p>
                <p className="mt-0.5 text-sm text-ink-2">{tStored(f.inactiveReason)}{t(". We’ll notify you when it reopens if it’s in your favorites.")}</p>
              </div>
            </div>
          )}
          {d.upcomingMaintenance.length > 0 && !inactive && (
            <div className="mt-5 flex gap-3 rounded-2xl border border-warning/25 bg-warning-soft p-4">
              <Wrench className="mt-0.5 size-5 shrink-0 text-warning" />
              <div className="text-sm">
                <p className="font-bold text-ink">{t("Planned maintenance")}</p>
                {d.upcomingMaintenance.slice(0, 2).map((m) => (
                  <p key={m.id} className="mt-0.5 text-ink-2">
                    {fmtDayShort(m.start)}, {fmtRange(m.start, m.end)} — {m.reason}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Availability */}
          {!inactive && (
            <section id="availability" className="mt-8" aria-labelledby="avail-heading">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 id="avail-heading" className="text-xl font-bold tracking-tight text-ink">
                    {t("Choose a time")}
                  </h2>
                  <p className="mt-0.5 text-sm text-muted">
                    {format(new Date(day + "T12:00:00"), "EEEE d MMMM")} · {avail.data ? t("{sessions} you can book", { sessions: N.session(bookable) }) : t("Loading…")}
                  </p>
                </div>
              </div>
              {avail.data ? <DateStrip days={avail.data.days} value={day} onChange={setDay} /> : <Skeleton className="h-[76px]" />}
              <div className={cn("mt-5 transition-opacity", avail.isPlaceholderData && "opacity-50")}>
                {avail.isError ? (
                  <ErrorState compact error={avail.error} onRetry={() => avail.refetch()} />
                ) : !avail.data ? (
                  <SlotGridSkeleton />
                ) : avail.data.slots.length === 0 ? (
                  <EmptyState compact icon={CalendarCheck} title={t("Closed on this day")} body={t("{name} doesn’t run sessions on {v}s. Pick another day above.", { name: f.name, v: format(new Date(day + "T12:00:00"), "EEEE") })} />
                ) : (
                  <SlotGrid slots={avail.data.slots} selected={selected} onPick={pick} unitLabel={f.unitLabel} mode={f.mode} />
                )}
              </div>
              <div className="mt-5">
                <SlotLegend />
              </div>
            </section>
          )}

          {/* Fair use */}
          <section className="mt-10" aria-labelledby="rules-heading">
            <h2 id="rules-heading" className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink">
              <Scale className="size-5 text-brand" />{" "}{t("Booking rules")}
            </h2>
            <p className="mt-1 text-sm text-muted">{t("These keep")}{" "}{f.name}{" "}{t("fair for everyone. They’re applied automatically — you’ll always see why a session isn’t available.")}</p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {[...fairLines, ...otherLines].map((l) => {
                const I = POLICY_ICONS[l.icon] ?? Info;
                return (
                  <li key={l.text} className={cn("flex gap-3 rounded-2xl border p-3.5 text-[13px] leading-relaxed", l.tone === "fair" ? "border-brand/20 bg-brand-softer text-ink" : "border-line bg-surface text-ink-2")}>
                    <I className={cn("mt-0.5 size-4 shrink-0", l.tone === "fair" ? "text-brand" : "text-muted")} />
                    {l.text}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="mt-10 grid gap-8 md:grid-cols-2">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-ink">{t("About")}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{f.description}</p>
              <h3 className="mt-6 text-sm font-bold text-ink">{t("House rules")}</h3>
              <ul className="mt-2 space-y-1.5">
                {f.rules.map((r) => (
                  <li key={r} className="flex gap-2 text-sm text-ink-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-brand" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-ink">{t("Amenities")}</h2>
              <ul className="mt-3 grid grid-cols-2 gap-2">
                {f.amenities.map((a) => {
                  const m = AMENITIES[a];
                  return (
                    <li key={a} className="flex items-center gap-2.5 rounded-xl bg-surface-2/70 px-3 py-2.5 text-[13px] font-medium text-ink-2">
                      <m.icon className="size-4 shrink-0 text-muted" /> {m.label}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {popular.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-bold tracking-tight text-ink">{t("Popular times")}</h2>
              <p className="mb-4 mt-1 text-sm text-muted">{t("Share of sessions booked, by hour — last 4 weeks. Quieter hours are easier to get.")}</p>
              <ColumnChart ariaLabel={t("Share of capacity booked by hour of day")} data={popular.map(({ h, v }) => ({ label: `${String(h).padStart(2, "0")}:00`, tick: h % 2 === 0 ? String(h).padStart(2, "0") : "", value: v }))} format={(n) => `${Math.round(n * 100)}%`} height={120} highlight={popular.findIndex((p) => p.h === nowHour)} emphasis="highlight" />
            </section>
          )}

          <section id="location" className="mt-10 scroll-mt-24">
            <h2 className="text-xl font-bold tracking-tight text-ink">{t("Find it on campus")}</h2>
            <div className="relative mt-3 overflow-hidden rounded-3xl border border-line">
              <img src={BRAND_ASSETS.campus} alt={t("Aerial map of Badya University campus")} className="aspect-[16/8] w-full object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-black/15" />
              <motion.span className="absolute -translate-x-1/2 -translate-y-full" style={{ left: `${f.location.mapX}%`, top: `${f.location.mapY}%` }} initial={{ y: -10, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }} transition={{ type: "spring", stiffness: 300, damping: 14 }}>
                <span className="flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1.5 text-xs font-bold text-ink shadow-lg">
                  <MapPin className="size-3.5 text-brand" /> {f.location.building}
                </span>
                <span className="mx-auto block h-3 w-0.5 bg-surface" />
                <span className="mx-auto block size-2.5 rounded-full bg-brand ring-4 ring-white/70" />
              </motion.span>
            </div>
            <p className="mt-2 text-xs text-muted">{t("Map positions are approximate in this prototype.")}</p>
          </section>
        </div>

        {/* Desktop sticky booking panel */}
        {!inactive && desktop && (
          <aside className="hidden lg:block">
            <div className="sticky top-24">{selectionPanel}</div>
          </aside>
        )}
      </div>

      {/* Mobile sticky CTA */}
      {!inactive && !desktop && (
        <div className="glass fixed inset-x-0 bottom-0 z-40 border-t border-line px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <AnimatePresence mode="wait" initial={false}>
                {selectedSlot ? (
                  <motion.div key={selectedSlot.session.start} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.16 }}>
                    <p className="text-[15px] font-bold text-ink tabular">{fmtRange(selectedSlot.session.start, selectedSlot.session.end)}</p>
                    <p className="text-xs text-muted">{relDay(selectedSlot.session.start)} · {fmtMinutes(f.sessionMinutes)}</p>
                  </motion.div>
                ) : (
                  <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <p className="text-sm font-semibold text-ink">{t("Select a session")}</p>
                    <p className="text-xs text-muted">{d.next ? t("Next free: {when}", { when: `${relDay(d.next.start)} ${fmtTime(d.next.start)}` }) : t("Check another day")}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <Button size="lg" disabled={!selectedSlot} onClick={openBooking} className="min-w-36">
              {d.policy.approval.required ? t("Request") : t("Book now")}
            </Button>
          </div>
        </div>
      )}

      {sheet && <BookingSheet open={!!sheet} onClose={() => setSheet(null)} facility={d} start={sheet.start} end={sheet.end} mode={sheet.mode} />}
      <SlotInfoSheet
        slot={info}
        facilityId={f.id}
        facilityName={f.name}
        claimMinutes={d.policy.waitlist.claimMinutes}
        suggestion={info && info.status !== "waitlisted" ? suggestion : undefined}
        onClose={() => setInfo(null)}
        onPickSuggestion={(s) => {
          setInfo(null);
          setSelected(s.session.start);
          document.getElementById("availability")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
    </div>
  );
}

function FacilitySkeleton() {
  return (
    <div>
      <Skeleton className="h-[300px] w-full rounded-none lg:mx-6 lg:mt-6 lg:h-[380px] lg:w-auto lg:rounded-[28px]" />
      <div className="space-y-4 px-4 pt-6 sm:px-6">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-2/3" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-[76px]" />
        <SlotGridSkeleton />
      </div>
    </div>
  );
}
