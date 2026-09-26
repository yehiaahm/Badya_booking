import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Check, Lock, Moon, Sun, Sunrise, Wrench } from "lucide-react";
import type { DayChip, SlotView } from "@/api";
import type { SlotStatus } from "@/domain/engine/rules";
import { cn } from "@/lib/cn";
import { format, fmtTime, fromDayKey, isSameDay, addDays, fmtDayShort } from "@/lib/time";
import { clock } from "@/lib/time";
import { Skeleton } from "@/components/ui/Primitives";
import { L, t } from "@/i18n";

/* ───────────── Date strip ───────────── */

const dayDot: Record<DayChip["state"], string> = {
  open: "bg-success",
  few: "bg-warning",
  full: "bg-faint",
  closed: "bg-transparent",
  not_open: "bg-transparent",
  past: "bg-transparent",
};

export function DateStrip({ days, value, onChange }: { days: DayChip[]; value: string; onChange: (d: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const today = clock.now();
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-day="${value}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [value]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = days[Math.max(0, Math.min(days.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))];
    onChange(n.day);
    ref.current?.querySelector<HTMLElement>(`[data-day="${n.day}"]`)?.focus();
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={t("Choose a date")} className="no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:-mx-0 sm:px-0">
      {days.map((d, i) => {
        const date = fromDayKey(d.day);
        const active = d.day === value;
        const label = isSameDay(date, today) ? t("Today") : isSameDay(date, addDays(today, 1)) ? t("Tmrw") : format(date, "EEE");
        const locked = d.state === "not_open";
        const closed = d.state === "closed";
        return (
          <button
            key={d.day}
            data-day={d.day}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            aria-label={`${fmtDayShort(date)}${L(", ", "، ")}${closed ? t("Closed") : locked ? t("Not open yet") : d.state === "full" ? t("Fully booked") : t("{n} available", { n: d.bookable })}`}
            onClick={() => onChange(d.day)}
            className={cn("relative flex h-[76px] w-[58px] shrink-0 snap-start flex-col items-center justify-center rounded-2xl border transition-colors", active ? "border-transparent text-on-brand" : "border-line bg-surface text-ink hover:border-line-strong", (closed || locked) && !active && "text-faint")}
          >
            {active && <motion.span layoutId="date-strip" className="absolute inset-0 rounded-2xl bg-brand shadow-md" transition={{ type: "spring", stiffness: 520, damping: 38 }} />}
            <span className={cn("relative text-[11px] font-bold uppercase tracking-wide", active ? "text-on-brand/80" : "text-muted")}>{label}</span>
            <span className="relative mt-0.5 text-xl font-bold leading-none tabular">{format(date, "d")}</span>
            <span className="relative mt-1.5 flex h-2 items-center">{locked ? <Lock className={cn("size-2.5", active ? "text-on-brand" : "text-faint")} /> : closed ? <span className={cn("text-[9px] font-bold uppercase", active ? "text-on-brand/80" : "text-faint")}>{t("Closed")}</span> : <span className={cn("size-1.5 rounded-full", active ? "bg-on-brand" : dayDot[d.state])} />}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────── Slot grid ───────────── */

const REASON_SHORT: Record<string, () => string> = {
  consecutive: () => t("Back-to-back"),
  rest: () => t("Rest period"),
  daily_limit: () => t("Daily limit"),
  weekly_limit: () => t("Weekly limit"),
  active_limit: () => t("Limit reached"),
  campus_limit: () => t("Limit reached"),
  linked_group: () => t("Group rule"),
  overlap: () => t("Time clash"),
  restricted: () => t("Booking paused"),
  account_suspended: () => t("Suspended"),
  eligibility: () => t("Not eligible"),
  facility_inactive: () => t("Closed"),
  lead_time: () => t("Booking closed"),
};

export function slotCaption(s: SlotView, unitLabel: string, mode: "exclusive" | "shared"): string {
  const r = s.session.remaining;
  const unit = mode === "exclusive" ? unitLabel : "spot";
  switch (s.status) {
    case "mine":
      return t("Your booking");
    case "waitlisted":
      return t("You’re #{n}", { n: s.waitlistPosition });
    case "available":
      return s.session.capacity > 1 ? L(`${r} ${r === 1 ? unit : unit + "s"} left`, `متبقي ${r}`) : t("Available");
    case "limited":
      return t("Only {n} left", { n: r });
    case "waitlist":
      return s.session.waitlistCount ? t("Full · {n} waiting", { n: s.session.waitlistCount }) : t("Full · Waitlist");
    case "full":
      return t("Fully booked");
    case "blocked":
      return REASON_SHORT[s.reasons[0]?.code]?.() ?? t("Unavailable");
    case "maintenance":
      return t("Maintenance");
    case "past":
      return t("Started");
    case "closed":
      return t("Booking closed");
    case "not_open":
      return s.session.opensAt ? t("Opens {date}", { date: format(new Date(s.session.opensAt), "d MMM") }) : t("Not open yet");
  }
}

const slotStyle: Record<SlotStatus, string> = {
  available: "border-line bg-surface hover:border-brand/50 hover:bg-brand-softer text-ink",
  limited: "border-warning/30 bg-surface hover:border-warning/60 text-ink",
  mine: "border-brand bg-brand text-on-brand",
  waitlisted: "border-violet/40 bg-violet-soft text-ink",
  waitlist: "border-violet/25 bg-surface hatch text-ink-2 hover:border-violet/50",
  full: "border-line bg-surface-2 hatch text-muted",
  blocked: "border-line border-dashed bg-surface-2/70 text-muted hover:border-line-strong",
  maintenance: "border-warning/30 bg-warning-soft/60 hatch text-muted",
  past: "border-transparent bg-surface-2/60 text-faint",
  closed: "border-transparent bg-surface-2/60 text-faint",
  not_open: "border-line border-dashed bg-transparent text-faint",
};

const captionStyle: Partial<Record<SlotStatus, string>> = {
  available: "text-success",
  limited: "text-warning",
  mine: "text-on-brand/85",
  waitlisted: "text-violet",
  waitlist: "text-violet",
  blocked: "text-muted",
};

export function SlotGrid({ slots, selected, onPick, unitLabel, mode }: { slots: SlotView[]; selected: string | null; onPick: (s: SlotView) => void; unitLabel: string; mode: "exclusive" | "shared" }) {
  const groups: { key: string; label: string; icon: typeof Sun; items: SlotView[] }[] = [
    { key: "m", label: t("Morning"), icon: Sunrise, items: [] },
    { key: "a", label: t("Afternoon"), icon: Sun, items: [] },
    { key: "e", label: t("Evening"), icon: Moon, items: [] },
  ];
  for (const s of slots) {
    const h = new Date(s.session.start).getHours();
    groups[h < 12 ? 0 : h < 17 ? 1 : 2].items.push(s);
  }
  return (
    <div className="space-y-5">
      {groups
        .filter((g) => g.items.length)
        .map((g) => {
          const open = g.items.filter((s) => s.status === "available" || s.status === "limited").length;
          return (
            <section key={g.key} aria-label={t("{label} sessions", { label: g.label })}>
              <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-bold text-ink-2">
                <g.icon className="size-4 text-muted" />
                {g.label}
                <span className="font-medium text-faint">· {open ? t("{n} available", { n: open }) : t("none available")}</span>
              </h3>
              <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-4">
                {g.items.map((s, i) => {
                  const isSel = selected === s.session.start;
                  const disabledish = s.status === "past" || s.status === "closed";
                  return (
                    <motion.button
                      key={s.session.start}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.025, 0.25), duration: 0.22 }}
                      whileTap={disabledish ? undefined : { scale: 0.96 }}
                      onClick={() => onPick(s)}
                      aria-pressed={isSel}
                      aria-label={t("{time} to {time2}, {slotCaption}", { time: fmtTime(s.session.start), time2: fmtTime(s.session.end), slotCaption: slotCaption(s, unitLabel, mode) })}
                      className={cn("relative flex min-h-[66px] flex-col items-start justify-center rounded-2xl border px-3 py-2 text-start transition-colors", slotStyle[s.status], isSel && "border-brand! bg-brand-soft! ring-4 ring-brand/15", disabledish && "cursor-default")}
                    >
                      <span className={cn("flex w-full items-center justify-between text-[17px] font-bold leading-none tabular", s.status === "past" && "line-through decoration-1")}>
                        {fmtTime(s.session.start)}
                        {(s.status === "mine" || isSel) && <Check className="size-4" strokeWidth={3} />}
                        {s.status === "blocked" && <Lock className="size-3.5" />}
                        {s.status === "not_open" && <Lock className="size-3.5" />}
                        {s.status === "maintenance" && <Wrench className="size-3.5 text-warning" />}
                      </span>
                      <span className={cn("mt-1 text-[11px] font-semibold leading-tight", captionStyle[s.status])}>{slotCaption(s, unitLabel, mode)}</span>
                      {s.status === "limited" && <span className="absolute end-2 top-2 size-1.5 rounded-full bg-warning" />}
                    </motion.button>
                  );
                })}
              </div>
            </section>
          );
        })}
    </div>
  );
}

export function SlotLegend() {
  const items: [string, string][] = [
    [t("Available"), "border-line bg-surface"],
    [t("Almost full"), "border-warning/40 bg-surface"],
    [t("Waitlist open"), "border-violet/30 bg-surface hatch"],
    [t("Not available to you"), "border-dashed border-line-strong bg-surface-2"],
    [t("Maintenance"), "border-warning/30 bg-warning-soft hatch"],
    [t("Your booking"), "border-brand bg-brand"],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted" aria-label={t("Legend")}>
      {items.map(([l, c]) => (
        <li key={l} className="flex items-center gap-1.5">
          <span className={cn("size-3.5 rounded-[5px] border", c)} />
          {l}
        </li>
      ))}
    </ul>
  );
}

export function SlotGridSkeleton() {
  return (
    <div className="space-y-5">
      {[0, 1].map((g) => (
        <div key={g}>
          <Skeleton className="mb-3 h-4 w-40" />
          <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[66px] rounded-2xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
