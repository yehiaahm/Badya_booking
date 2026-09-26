import { Link, useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { Clock3, Heart, MapPin, Users, Wrench } from "lucide-react";
import type { FacilitySummary } from "@/api";
import type { Facility } from "@/domain/types";
import { cn } from "@/lib/cn";
import { dayKey, fmtTime, relDay } from "@/lib/time";
import { useToggleFavorite } from "@/lib/queries";
import { toast } from "@/components/ui/Toast";
import { FacilityArt } from "./FacilityArt";
import { L, N, arCount, t, tStored } from "@/i18n";

export function capacityLabel(f: Facility): string {
  const upTo = L(`Up to ${f.capacity} people`, `حتى ${arCount(f.capacity, "شخص واحد", "شخصين", "أشخاص", "شخصًا")}`);
  if (f.mode === "shared") return L(`${f.units} ${f.unitLabel}s per session`, `${f.units} ${f.unitLabel} لكل موعد`);
  if (f.units > 1) return L(`${f.units} ${f.unitLabel}s · up to ${f.capacity} each`, `${f.units} × ${f.unitLabel} · ${upTo}`);
  return upTo;
}

export function locationLabel(f: Facility): string {
  return [f.location.building, f.location.area ?? f.location.floor].filter(Boolean).join(" · ");
}

export function availabilityInfo(s: FacilitySummary): { text: string; tone: "success" | "warning" | "danger" | "muted" } {
  if (s.facility.status !== "active") return { text: s.facility.inactiveReason ? tStored(s.facility.inactiveReason) : t("Temporarily closed"), tone: "danger" };
  if (s.maintenanceNow) return { text: t("Maintenance until {time}", { time: fmtTime(s.maintenanceNow.end) }), tone: "warning" };
  const next = s.next ? `${relDay(s.next.start)} ${fmtTime(s.next.start)}` : null;
  switch (s.today.state) {
    case "open":
      return { text: t("{sessions} left today", { sessions: N.session(s.today.bookable) }), tone: "success" };
    case "few":
      return { text: t("Only {sessions} left today", { sessions: N.session(s.today.bookable) }), tone: "warning" };
    case "full":
      return { text: next ? t("Full today · next {next}", { next }) : t("Fully booked today"), tone: "muted" };
    default:
      return { text: next ? t("Next available {next}", { next }) : t("No sessions this week"), tone: "muted" };
  }
}

export function FavoriteButton({ facilityId, active, className, name }: { facilityId: string; active: boolean; className?: string; name: string }) {
  const toggle = useToggleFavorite();
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? t("Remove {name} from favorites", { name }) : t("Add {name} to favorites", { name })}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle.mutate(facilityId, {
          onSuccess: (on) => on && toast.success(t("Added to favorites"), t("{name} is one tap away on your Favorites page.", { name })),
        });
      }}
      className={cn("glass relative flex size-9 items-center justify-center rounded-full shadow-md transition-transform active:scale-90", className)}
    >
      <motion.span key={String(active)} initial={{ scale: active ? 0.4 : 1 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 520, damping: 14 }}>
        <Heart className={cn("size-[18px] transition-colors", active ? "fill-[#e0455b] text-[#e0455b]" : "text-ink-2")} strokeWidth={2} />
      </motion.span>
      <AnimatePresence>
        {active && (
          <motion.span className="pointer-events-none absolute inset-0 rounded-full border-2 border-[#e0455b]" initial={{ scale: 0.6, opacity: 0.8 }} animate={{ scale: 1.6, opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }} />
        )}
      </AnimatePresence>
    </button>
  );
}

const toneDot = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", muted: "bg-faint" };
const toneText = { success: "text-success", warning: "text-warning", danger: "text-danger", muted: "text-muted" };

export function FacilityCard({ s, variant = "grid", className }: { s: FacilitySummary; variant?: "grid" | "rail" | "row"; className?: string }) {
  const f = s.facility;
  const nav = useNavigate();
  const av = availabilityInfo(s);
  const inactive = f.status !== "active";
  const hours = s.today.hours;

  if (variant === "row") {
    return (
      <Link to={`/facility/${f.id}`} className={cn("group flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-2.5 pe-4 shadow-sm transition-all hover:border-line-strong hover:shadow-md", className)}>
        <FacilityArt motif={f.media.motif} accent={f.media.accent} imageUrl={f.media.imageUrl} className="size-16 shrink-0 rounded-xl" dim={inactive} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-ink">{f.name}</p>
          <p className="truncate text-xs text-muted">{locationLabel(f)}</p>
          <p className={cn("mt-1 flex items-center gap-1.5 text-xs font-semibold", toneText[av.tone])}>
            <span className={cn("size-1.5 rounded-full", toneDot[av.tone])} />
            {av.text}
          </p>
        </div>
      </Link>
    );
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn("group relative flex flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-sm transition-[box-shadow,transform,border-color] duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-md", variant === "rail" && "w-[272px] shrink-0 snap-start sm:w-[300px]", className)}
    >
      <div className="relative">
        <FacilityArt motif={f.media.motif} accent={f.media.accent} imageUrl={f.media.imageUrl} className={cn("aspect-[16/10] w-full transition-transform duration-500 group-hover:scale-[1.03]", variant === "rail" && "aspect-[16/9]")} dim={inactive} alt={t("{name} plan view", { name: f.name })} />
        <div className="absolute inset-x-3 top-3 z-10 flex items-start justify-between">
          <span className="glass rounded-full px-2.5 py-1 text-[11px] font-bold text-ink shadow-sm">{s.category.name}</span>
          <FavoriteButton facilityId={f.id} active={s.isFavorite} name={f.name} />
        </div>
        {(s.openNow || inactive || s.maintenanceNow) && (
          <span className={cn("absolute bottom-3 start-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold shadow-sm", inactive ? "bg-danger text-white" : s.maintenanceNow ? "bg-warning text-white" : "glass text-success")}>
            {s.maintenanceNow ? <Wrench className="size-3" /> : <span className={cn("size-1.5 rounded-full", inactive ? "bg-white" : "live-dot bg-success")} />}
            {inactive ? t("Closed") : s.maintenanceNow ? t("Maintenance") : t("Open now")}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[16px] font-bold leading-tight tracking-tight text-ink">
          <Link to={`/facility/${f.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {f.name}
          </Link>
        </h3>
        <p className="mt-1 flex items-center gap-1 text-[13px] text-muted">
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">{locationLabel(f)}</span>
        </p>
        {variant === "grid" && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{f.shortDescription}</p>}
        <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1 text-xs font-medium text-muted">
          <span className="flex items-center gap-1">
            <Users className="size-3.5" /> {capacityLabel(f)}
          </span>
          <span className="flex items-center gap-1">
            <Clock3 className="size-3.5" /> {f.sessionMinutes}{" "}{t("min")}
          </span>
          {hours && variant === "grid" && (
            <span>
              {hours.open}–{hours.close}
            </span>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <p className={cn("flex min-w-0 items-center gap-1.5 text-[13px] font-semibold", toneText[av.tone])}>
            <span className={cn("size-2 shrink-0 rounded-full", toneDot[av.tone])} />
            <span className="truncate">{av.text}</span>
          </p>
          {!inactive && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                nav(`/facility/${f.id}${s.next ? `?day=${dayKey(s.next.start)}` : ""}`);
              }}
              className="relative z-10 shrink-0 rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold text-on-brand transition-colors hover:bg-brand-hover active:scale-95"
            >
              {t("Book")}
            </button>
          )}
        </div>
      </div>
    </motion.article>
  );
}

export function FacilityCardSkeleton({ variant = "grid" }: { variant?: "grid" | "rail" }) {
  return (
    <div className={cn("overflow-hidden rounded-[22px] border border-line bg-surface", variant === "rail" && "w-[272px] shrink-0 sm:w-[300px]")}>
      <div className="skeleton aspect-[16/10] w-full rounded-none" />
      <div className="space-y-2.5 p-4">
        <div className="skeleton h-4 w-2/3 rounded-lg" />
        <div className="skeleton h-3 w-1/2 rounded-lg" />
        <div className="skeleton h-3 w-full rounded-lg" />
        <div className="flex justify-between pt-3">
          <div className="skeleton h-3.5 w-28 rounded-lg" />
          <div className="skeleton h-7 w-14 rounded-full" />
        </div>
      </div>
    </div>
  );
}
