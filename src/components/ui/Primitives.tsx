import { useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, RotateCw, WifiOff, type LucideIcon } from "lucide-react";
import { cn, initials } from "@/lib/cn";
import { ApiError } from "@/api";
import { Button } from "./Button";
import { t } from "@/i18n";

/* ───────────── Badge ───────────── */

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet" | "dusk";

const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 ring-line",
  brand: "bg-brand-soft text-brand-strong ring-brand/15",
  success: "bg-success-soft text-success ring-success/15",
  warning: "bg-warning-soft text-warning ring-warning/15",
  danger: "bg-danger-soft text-danger ring-danger/15",
  info: "bg-info-soft text-info ring-info/15",
  violet: "bg-violet-soft text-violet ring-violet/15",
  dusk: "bg-dusk text-on-dusk ring-transparent",
};

export function Badge({ tone = "neutral", children, icon, className, dot, size = "sm" }: { tone?: Tone; children: ReactNode; icon?: ReactNode; className?: string; dot?: boolean; size?: "xs" | "sm" }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full font-semibold ring-1 ring-inset whitespace-nowrap", size === "xs" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs", toneClass[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {icon}
      {children}
    </span>
  );
}

/* ───────────── Card ───────────── */

export function Card({ className, children, interactive, ...rest }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div className={cn("rounded-[20px] border border-line bg-surface shadow-sm", interactive && "transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, action, subtitle, className, as: As = "h2" }: { title: ReactNode; action?: ReactNode; subtitle?: ReactNode; className?: string; as?: "h2" | "h3" }) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <As className="text-[17px] font-bold tracking-tight text-ink">{title}</As>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ───────────── Avatar ───────────── */

export function Avatar({ name, hue = 30, size = 36, className, ring }: { name: string; hue?: number; size?: number; className?: string; ring?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold tracking-tight", ring && "ring-2 ring-surface", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.36),
        background: `linear-gradient(145deg, hsl(${hue} 42% 78%), hsl(${(hue + 25) % 360} 38% 62%))`,
        color: `hsl(${hue} 45% 18%)`,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 28 }: { people: { name: string; avatarHue: number }[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <span key={i} style={{ marginLeft: i ? -size * 0.3 : 0 }}>
          <Avatar name={p.name} hue={p.avatarHue} size={size} ring />
        </span>
      ))}
      {people.length > max && (
        <span className="inline-flex items-center justify-center rounded-full bg-surface-3 text-[11px] font-bold text-ink-2 ring-2 ring-surface" style={{ width: size, height: size, marginLeft: -size * 0.3 }}>
          +{people.length - max}
        </span>
      )}
    </div>
  );
}

/* ───────────── Skeleton ───────────── */

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn("skeleton rounded-xl", className)} style={style} />;
}

/* ───────────── Tabs & segmented control ───────────── */

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
}

export function Tabs<T extends string>({ items, value, onChange, className, variant = "underline", size = "md" }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string; variant?: "underline" | "pill"; size?: "sm" | "md" }) {
  const id = useId();
  const onKey = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = items[(idx + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
    onChange(next.value);
    document.getElementById(`${id}-${next.value}`)?.focus();
  };
  return (
    <div role="tablist" className={cn("no-scrollbar flex overflow-x-auto", variant === "underline" ? "gap-5 border-b border-line" : "gap-1 rounded-2xl bg-surface-2 p-1", className)}>
      {items.map((it, idx) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            id={`${id}-${it.value}`}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => onKey(e, idx)}
            onClick={() => onChange(it.value)}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 font-semibold whitespace-nowrap transition-colors",
              size === "sm" ? "text-[13px]" : "text-sm",
              variant === "underline" ? cn("pb-3 pt-1", active ? "text-ink" : "text-muted hover:text-ink-2") : cn("rounded-xl px-3.5", size === "sm" ? "h-8" : "h-9", active ? "text-ink" : "text-muted hover:text-ink"),
            )}
          >
            {active && variant === "pill" && <motion.span layoutId={`${id}-pill`} className="absolute inset-0 rounded-xl bg-surface shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative flex items-center gap-1.5">
              {it.icon}
              {it.label}
              {it.count !== undefined && <span className={cn("rounded-full px-1.5 text-[11px] tabular", active ? "bg-brand-soft text-brand-strong" : "bg-surface-3 text-muted")}>{it.count}</span>}
            </span>
            {active && variant === "underline" && <motion.span layoutId={`${id}-line`} className="absolute inset-x-0 -bottom-px h-[2.5px] rounded-full bg-brand" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────── Empty & error states ───────────── */

export function EmptyState({ icon: Icon, title, body, action, className, compact }: { icon: LucideIcon; title: ReactNode; body?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("flex flex-col items-center text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      <div className="relative mb-4">
        <svg viewBox="0 0 96 96" className={cn(compact ? "size-16" : "size-24")} aria-hidden>
          <path d="M8 92 V46 A40 40 0 0 1 88 46 V92" fill="var(--brand-softer)" stroke="var(--line-strong)" strokeWidth="1.5" />
          <path d="M22 92 V50 A26 26 0 0 1 74 50 V92" fill="none" stroke="var(--line)" strokeWidth="1.5" strokeDasharray="3 4" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center pt-4">
          <Icon className={cn("text-brand", compact ? "size-6" : "size-8")} strokeWidth={1.6} />
        </span>
      </div>
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

/** Human error messaging — technical details never reach students. */
export function ErrorState({ error, onRetry, className, compact }: { error: unknown; onRetry?: () => void; className?: string; compact?: boolean }) {
  const e = error instanceof ApiError ? error : null;
  const network = e?.code === "NETWORK";
  const title = network ? t("You’re offline") : e?.code === "FORBIDDEN" ? t("You don’t have access") : e?.code === "NOT_FOUND" ? t("We couldn’t find that") : t("Something went wrong");
  const body = e?.message ?? t("We couldn’t load this right now. Please try again in a moment.");
  return (
    <div role="alert" className={cn("flex flex-col items-center text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      <div className={cn("mb-4 flex size-14 items-center justify-center rounded-2xl", network ? "bg-info-soft text-info" : "bg-danger-soft text-danger")}>{network ? <WifiOff className="size-6" /> : <AlertTriangle className="size-6" />}</div>
      <h3 className="text-base font-bold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{body}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" icon={<RotateCw className="size-4" />} onClick={onRetry}>
          {t("Try again")}
        </Button>
      )}
    </div>
  );
}

/* ───────────── Progress ───────────── */

export function ProgressBar({ value, max = 1, tone = "brand", className, label }: { value: number; max?: number; tone?: "brand" | "success" | "warning" | "danger" | "info"; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const color = { brand: "bg-brand", success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info" }[tone];
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className={cn("h-1.5 overflow-hidden rounded-full bg-surface-3", className)}>
      <motion.div className={cn("h-full rounded-full", color)} initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
    </div>
  );
}

export function Ring({ value, size = 44, stroke = 4, color = "var(--brand)", track = "var(--surface-3)", children }: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, value))) }} transition={{ duration: 0.5, ease: "linear" }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
    </div>
  );
}

/* ───────────── Menu ───────────── */

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({ trigger, items, align = "end", label }: { trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode; items: MenuItem[]; align?: "start" | "end"; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    setTimeout(() => ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus(), 20);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const els = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    }
  };
  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu" })}
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label={label}
            onKeyDown={onKey}
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            className={cn("absolute top-full z-[60] mt-1.5 min-w-52 origin-top overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-lg", align === "end" ? "end-0" : "start-0")}
          >
            {items.map((it, i) => (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={cn("flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm font-medium outline-none transition-colors hover:bg-surface-2 focus:bg-surface-2 disabled:opacity-40", it.danger ? "text-danger" : "text-ink")}
              >
                {it.icon && <span className="text-muted [&>svg]:size-4">{it.icon}</span>}
                {it.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────── Misc ───────────── */

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-surface-2 px-1 font-sans text-[11px] font-semibold text-muted">{children}</kbd>;
}

export function Stat({ label, value, hint, icon, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        {icon && <span className={cn("[&>svg]:size-3.5", tone === "danger" && "text-danger", tone === "success" && "text-success")}>{icon}</span>}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tracking-tight text-ink tabular">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-line", className)} />;
}
