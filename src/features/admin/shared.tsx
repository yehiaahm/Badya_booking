import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Minus } from "lucide-react";
import type { StandingLevel } from "@/domain/engine/standing";
import { cn } from "@/lib/cn";
import { Button, type ButtonVariant } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Form";
import { Badge, type Tone } from "@/components/ui/Primitives";
import { Dialog } from "@/components/ui/Overlay";
import { t } from "@/i18n";

/* ───────────── URL-backed filters ───────────── */

/** Read and patch query-string filters; empty values are removed. Resets `page` unless it is being set. */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const patch = (next: Record<string, string | number | null | undefined>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(next)) v === null || v === undefined || v === "" ? n.delete(k) : n.set(k, String(v));
        if (!("page" in next)) n.delete("page");
        return n;
      },
      { replace: true },
    );
  return { params, get, patch };
}

/* ───────────── KPIs ───────────── */

/**
 * Change between two periods. `unit: "pts"` compares rates in percentage points;
 * `goodWhen` decides the colour — a drop in no-shows is good news.
 */
export function Delta({ now, prev, unit = "pct", goodWhen = "up", className }: { now: number; prev: number; unit?: "pct" | "pts"; goodWhen?: "up" | "down"; className?: string }) {
  const diff = unit === "pts" ? (now - prev) * 100 : prev ? ((now - prev) / prev) * 100 : 0;
  const flat = Math.abs(diff) < 0.5;
  const good = flat ? null : (diff > 0) === (goodWhen === "up");
  const Icon = flat ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold tabular", good === null ? "text-muted" : good ? "text-success" : "text-danger", className)}>
      <Icon className="size-3.5" />
      {flat ? t("No change") : `${Math.abs(diff).toFixed(unit === "pts" ? 1 : 0)}${unit === "pts" ? ` ${t("pts")}` : "%"}`}
    </span>
  );
}

export function Kpi({ label, value, hint, delta, icon, to, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; delta?: ReactNode; icon?: ReactNode; to?: string; tone?: "danger" | "warning" }) {
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        {icon && <span className={cn("[&>svg]:size-4", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-faint")}>{icon}</span>}
        {label}
      </p>
      <p className="mt-2 text-[26px] font-bold leading-none tracking-tight text-ink tabular">{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
        {delta}
        {hint && <span>{hint}</span>}
      </div>
    </>
  );
  const cls = "block rounded-[20px] border border-line bg-surface p-4 shadow-sm";
  return to ? (
    <Link to={to} className={cn(cls, "transition-colors hover:border-line-strong")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/* ───────────── Tables ───────────── */

export const th = "px-3 py-2.5 text-start text-xs font-semibold text-muted whitespace-nowrap";
export const td = "px-3 py-3 align-middle";

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-[20px] border border-line bg-surface shadow-sm", className)}>
      <table className="w-full text-[13px]">{children}</table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className="mt-3 text-xs text-muted">{total}{" "}{t("total")}</p> : null;
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted">
      <span className="tabular">
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)}{" "}{t("of")}{" "}{total}
      </span>
      <div className="flex items-center gap-1">
        <Button size="xs" variant="ghost" icon={<ChevronLeft className="size-3.5" />} disabled={page <= 1} onClick={() => onChange(page - 1)}>
          {t("Previous")}
        </Button>
        <span className="px-2 tabular">
          {page} / {pages}
        </span>
        <Button size="xs" variant="ghost" iconRight={<ChevronRight className="size-3.5" />} disabled={page >= pages} onClick={() => onChange(page + 1)}>
          {t("Next")}
        </Button>
      </div>
    </div>
  );
}

/* ───────────── Standing ───────────── */

export const LEVEL_META: Record<StandingLevel, { label: string; tone: Tone }> = {
  good: { get label() {
    return t("Good standing");
  }, tone: "success" },
  warning: { get label() {
    return t("Warning");
  }, tone: "warning" },
  final_warning: { get label() {
    return t("Final warning");
  }, tone: "danger" },
  restricted: { get label() {
    return t("Paused");
  }, tone: "danger" },
};

export function LevelBadge({ level, size = "xs" }: { level: StandingLevel; size?: "xs" | "sm" }) {
  const m = LEVEL_META[level];
  return (
    <Badge tone={m.tone} size={size} dot>
      {m.label}
    </Badge>
  );
}

/* ───────────── Reason capture ───────────── */

/** Confirm an action that needs a reason — the reason is shown to students and kept in the audit log. */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  presets = [],
  confirmLabel,
  dismissLabel,
  variant = "primary",
  loading,
  error,
  minLength = 4,
  optional,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  presets?: string[];
  confirmLabel: string;
  /** Instead of "Cancel" — needed when the action itself is a cancellation ("Keep booking" / "Cancel booking"). */
  dismissLabel?: string;
  variant?: ButtonVariant;
  loading?: boolean;
  error?: string;
  minLength?: number;
  optional?: boolean;
  onConfirm: (reason: string) => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const valid = optional || reason.trim().length >= minLength;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {dismissLabel ?? t("Cancel")}
          </Button>
          <Button variant={variant} loading={loading} disabled={!valid} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {children}
        <Field label={t("Reason")} optional={optional} htmlFor="reason-text" hint={t("Shown to the people affected and kept in the audit log.")} error={error}>
          {presets.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {presets.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} className={cn("h-7 rounded-full border px-2.5 text-xs font-semibold", reason === r ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-muted hover:text-ink")}>
                  {r}
                </button>
              ))}
            </div>
          )}
          <Textarea id="reason-text" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-20" maxLength={300} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ───────────── Export ───────────── */

export function downloadCsv(filename: string, columns: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    // Text starting with = + - @ (or a tab/CR) would run as a formula in Excel — neutralise it.
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  // BOM so Excel opens Arabic names correctly.
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
