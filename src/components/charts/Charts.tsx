import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Table2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/cn";
import { currentLanguage, t as tr } from "@/i18n";

/**
 * Small, accessible chart kit (HTML/CSS, no chart library).
 * Mark specs follow the data-viz guidance: bars ≤ 24px with 4px rounded
 * data-ends, hairline solid gridlines, one colour for one series, a 2-series
 * legend, hover + keyboard tooltips, and a table view for every chart.
 */

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtPct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

/* ───────────── Card shell with table view ───────────── */

export function ChartCard({ title, subtitle, children, table, action, className }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; table?: { columns: string[]; rows: (string | number)[][] }; action?: ReactNode; className?: string }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={cn("rounded-[20px] border border-line bg-surface p-5 shadow-sm", className)}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          {table && (
            <button onClick={() => setAsTable((t) => !t)} aria-pressed={asTable} className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink" title={asTable ? tr("Show chart") : tr("Show as table")}>
              {asTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
              <span className="hidden sm:inline">{asTable ? tr("Chart") : tr("Table")}</span>
            </button>
          )}
        </div>
      </header>
      {asTable && table ? (
        <div className="max-h-80 overflow-auto rounded-xl border border-line">
          <table className="w-full text-start text-[13px]">
            <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((v, j) => (
                    <td key={j} className={cn("px-3 py-1.5", j === 0 ? "font-medium text-ink" : "text-ink-2")}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/* ───────────── Tooltip ───────────── */

function Tip({ show, x, children }: { show: boolean; x: number; children: ReactNode }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          role="tooltip"
          className="pointer-events-none absolute bottom-full z-20 mb-2 min-w-32 -translate-x-1/2 whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: `${x}%` }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────── Column chart (one series) ───────────── */

export interface ColumnDatum {
  label: string;
  /** Short tick label; omit to hide the tick. */
  tick?: string;
  value: number;
  detail?: ReactNode;
}

export function ColumnChart({ data, height = 180, format = fmtInt, highlight, ariaLabel, emphasis = "all" }: { data: ColumnDatum[]; height?: number; format?: (n: number) => string; highlight?: number; ariaLabel: string; emphasis?: "all" | "highlight" }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const ticks = [0, max / 2, max];
  const id = useId();
  return (
    <div className="relative" role="figure" aria-label={ariaLabel} dir="ltr">
      <div className="flex">
        <div className="relative me-2 flex w-9 shrink-0 flex-col justify-between text-end text-[11px] text-muted tabular" style={{ height }}>
          {[...ticks].reverse().map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {format(t)}
            </span>
          ))}
        </div>
        <div className="relative flex-1" style={{ height }}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-line" style={{ bottom: `${(t / max) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d, i) => {
              const h = max ? (d.value / max) * 100 : 0;
              const dim = emphasis === "highlight" && highlight !== undefined && i !== highlight;
              return (
                <button
                  key={i}
                  type="button"
                  aria-describedby={hover === i ? `${id}-tip` : undefined}
                  aria-label={`${d.label}: ${format(d.value)}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="group relative flex h-full flex-1 cursor-default items-end justify-center outline-none"
                >
                  <motion.span
                    className="block w-full max-w-6 rounded-t-[4px] transition-[filter]"
                    style={{ background: dim ? "var(--viz-1-soft)" : "var(--viz-1)", filter: hover === i ? "brightness(1.12)" : undefined }}
                    initial={{ height: 0 }}
                    animate={{ height: `${h}%` }}
                    transition={{ duration: 0.5, delay: Math.min(i * 0.012, 0.3), ease: [0.22, 1, 0.36, 1] }}
                  />
                  {highlight === i && <span className="absolute -bottom-0 left-1/2 h-[3px] w-full max-w-6 -translate-x-1/2 translate-y-[5px] rounded-full bg-ink" />}
                  <Tip show={hover === i} x={50}>
                    <span id={`${id}-tip`}>
                      <span className="block text-sm font-bold text-ink">{format(d.value)}</span>
                      <span className="block text-muted">{d.label}</span>
                      {d.detail && <span className="mt-1 block text-ink-2">{d.detail}</span>}
                    </span>
                  </Tip>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ms-11 mt-2 flex gap-[2px] text-[10.5px] text-muted">
        {data.map((d, i) => (
          <span key={i} className="flex-1 text-center tabular">
            {d.tick ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ───────────── Horizontal bar list (one series) ───────────── */

export function BarList({ rows, format = fmtPct, max, ariaLabel }: { rows: { label: ReactNode; value: number; sub?: ReactNode; key: string }[]; format?: (n: number) => string; max?: number; ariaLabel: string }) {
  const m = max ?? Math.max(...rows.map((r) => r.value), 0.0001);
  return (
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {rows.map((r, i) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9.5rem)_1fr_3.2rem] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,12rem)_1fr_3.5rem]">
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{r.label}</span>
            {r.sub && <span className="block truncate text-[11px] text-muted">{r.sub}</span>}
          </span>
          <span className="relative h-3.5">
            <motion.span className="absolute inset-y-0 start-0 rounded-e-[4px]" style={{ background: "var(--viz-1)" }} initial={{ width: 0 }} animate={{ width: `${(r.value / m) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }} />
          </span>
          <span className="text-end font-semibold text-ink tabular">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ───────────── Paired bars (two series) ───────────── */

export function PairedBars({ rows, series, format = fmtPct, ariaLabel }: { rows: { key: string; label: string; a: number; b: number }[]; series: [string, string]; format?: (n: number) => string; ariaLabel: string }) {
  const m = Math.max(...rows.flatMap((r) => [r.a, r.b]), 0.0001);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-ink-2" aria-hidden>
        {series.map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: i ? "var(--viz-2)" : "var(--viz-1)" }} />
            {s}
          </span>
        ))}
      </div>
      <ul className="space-y-3" aria-label={ariaLabel}>
        {rows.map((r) => (
          <li key={r.key} className="relative grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-[13px]" onPointerEnter={() => setHover(r.key)} onPointerLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(r.key)} onBlur={() => setHover(null)} aria-label={`${r.label}: ${series[0]} ${format(r.a)}, ${series[1]} ${format(r.b)}`}>
            <span className="truncate font-medium text-ink">{r.label}</span>
            <span className="relative space-y-[2px]">
              {[r.a, r.b].map((v, i) => (
                <span key={i} className="flex items-center gap-2">
                  <motion.span className="block h-2.5 rounded-e-[4px]" style={{ background: i ? "var(--viz-2)" : "var(--viz-1)" }} initial={{ width: 0 }} animate={{ width: `${Math.max(1, (v / m) * 88)}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
                  <span className="text-[11px] font-semibold text-ink-2 tabular">{format(v)}</span>
                </span>
              ))}
              <Tip show={hover === r.key} x={40}>
                <span className="block font-bold text-ink">{r.label}</span>
                {series.map((s, i) => (
                  <span key={s} className="mt-1 flex items-center gap-2 text-ink-2">
                    <span className="h-0.5 w-3 rounded-full" style={{ background: i ? "var(--viz-2)" : "var(--viz-1)" }} />
                    <span className="font-bold text-ink">{format(i ? r.b : r.a)}</span> {s}
                  </span>
                ))}
              </Tip>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────── Heatmap (weekday × hour) ───────────── */

const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_AR = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

export function Heatmap({ cells, order = [6, 0, 1, 2, 3, 4, 5], ariaLabel }: { cells: { weekday: number; hour: number; value: number }[]; order?: number[]; ariaLabel: string }) {
  const DAYS = currentLanguage() === "ar" ? DAYS_AR : DAYS_EN;
  const hours = [...new Set(cells.map((c) => c.hour))].sort((a, b) => a - b);
  const get = (d: number, h: number) => cells.find((c) => c.weekday === d && c.hour === h)?.value ?? 0;
  const step = (v: number) => (v <= 0.02 ? 0 : Math.min(6, 1 + Math.floor(v * 6)));
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  return (
    <div role="figure" aria-label={ariaLabel} dir="ltr">
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          {order.map((d) => (
            <div key={d} className="flex items-center gap-[2px] py-[1px]">
              <span className="w-9 shrink-0 text-[11px] font-medium text-muted">{DAYS[d]}</span>
              {hours.map((h) => {
                const v = get(d, h);
                const on = hover?.d === d && hover.h === h;
                return (
                  <span
                    key={h}
                    tabIndex={0}
                    role="img"
                    aria-label={tr("{v} {padStart}:00 — {pct} booked", { v: DAYS[d], padStart: String(h).padStart(2, "0"), pct: fmtPct(v) })}
                    onPointerEnter={() => setHover({ d, h })}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover({ d, h })}
                    onBlur={() => setHover(null)}
                    className={cn("relative h-6 flex-1 rounded-[4px] outline-none transition-transform", on && "z-10 scale-110 ring-2 ring-surface")}
                    style={{ background: `var(--viz-seq-${step(v)})` }}
                  >
                    <Tip show={on} x={50}>
                      <span className="block text-sm font-bold text-ink">{fmtPct(v)}{" "}{tr("booked")}</span>
                      <span className="block text-muted">
                        {DAYS[d]} · {String(h).padStart(2, "0")}:00–{String(h + 1).padStart(2, "0")}:00
                      </span>
                    </Tip>
                  </span>
                );
              })}
            </div>
          ))}
          <div className="mt-1.5 flex gap-[2px] ps-[38px] text-[10.5px] text-muted tabular">
            {hours.map((h) => (
              <span key={h} className="flex-1 text-center">
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
        <span>{tr("Quiet")}</span>
        <span className="flex gap-[2px]">
          {[0, 1, 2, 3, 4, 5, 6].map((s) => (
            <span key={s} className="h-2.5 w-5 rounded-[3px]" style={{ background: `var(--viz-seq-${s})` }} />
          ))}
        </span>
        <span>{tr("Busy (share of capacity booked)")}</span>
      </div>
    </div>
  );
}

/* ───────────── Sparkline ───────────── */

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${30 - ((v - min) / (max - min || 1)) * 28 - 1}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("h-8 w-24", className)} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--viz-1)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
