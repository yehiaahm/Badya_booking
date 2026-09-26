import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { motion } from "motion/react";
import { ChevronDown, Minus, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/i18n";

const control =
  "w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-faint shadow-sm transition-[border-color,box-shadow] duration-150 outline-none hover:border-line-strong focus:border-brand focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20";

export function Field({ label, hint, error, children, htmlFor, optional, className }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string; optional?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="flex items-baseline justify-between text-[13px] font-semibold text-ink">
          <span>{label}</span>
          {optional && <span className="text-xs font-normal text-faint">{t("Optional")}</span>}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; leading?: ReactNode; trailing?: ReactNode }>(function Input({ className, invalid, leading, trailing, ...rest }, ref) {
  if (leading || trailing) {
    return (
      <div className="relative">
        {leading && <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-faint">{leading}</span>}
        <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, "h-11", leading && "ps-10", trailing && "pe-10", className)} {...rest} />
        {trailing && <span className="absolute inset-y-0 end-2 flex items-center text-faint">{trailing}</span>}
      </div>
    );
  }
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, "h-11", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(control, "min-h-24 resize-y py-2.5 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} aria-invalid={invalid || undefined} className={cn(control, "h-11 appearance-none pe-9", className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
});

export function SearchInput({ value, onChange, placeholder = t("Search…"), className, autoFocus, size = "md", label = t("Search") }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; size?: "md" | "lg"; label?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className={cn("pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted", size === "lg" ? "size-5" : "size-4")} />
      <input
        type="search"
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(control, "[&::-webkit-search-cancel-button]:hidden", size === "lg" ? "h-13 rounded-2xl ps-11 text-[15px]" : "h-10 ps-10", value && "pe-9")}
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label={t("Clear search")} className="absolute end-2.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-surface-2 text-muted hover:text-ink">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean; id?: string }) {
  const auto = useId();
  const sid = id ?? auto;
  const toggle = (
    <button
      id={sid}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50", checked ? "bg-brand" : "bg-surface-3")}
    >
      <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 34 }} className={cn("size-5 rounded-full bg-white shadow-sm", checked ? "ms-[18px]" : "ms-0.5")} />
    </button>
  );
  if (!label) return toggle;
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={sid} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span>}
      </label>
      {toggle}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; className?: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 text-sm text-ink", className)}>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={cn("flex size-[18px] items-center justify-center rounded-[6px] border transition-colors peer-focus-visible:ring-4 peer-focus-visible:ring-[var(--ring)]", checked ? "border-brand bg-brand text-on-brand" : "border-line-strong bg-surface")}>
        {checked && (
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M3.5 8.5l3 3 6-7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.2 }} />
          </svg>
        )}
      </span>
      {label}
    </label>
  );
}

export function Stepper({ value, onChange, min = 0, max = 999, step = 1, unit, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; label: string }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="inline-flex h-11 items-center rounded-xl border border-line bg-surface shadow-sm">
      <button type="button" aria-label={t("Decrease {label}", { label })} className="flex h-full w-10 items-center justify-center text-muted hover:text-ink disabled:opacity-30" disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
        <Minus className="size-4" />
      </button>
      <label className="flex items-baseline gap-1 px-1">
        <span className="sr-only">{label}</span>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
          className="w-12 bg-transparent text-center text-sm font-semibold tabular outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        {unit && <span className="text-xs text-muted">{unit}</span>}
      </label>
      <button type="button" aria-label={t("Increase {label}", { label })} className="flex h-full w-10 items-center justify-center text-muted hover:text-ink disabled:opacity-30" disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}
