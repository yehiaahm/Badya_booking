import { CheckCircle2, Download, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAnalytics } from "@/lib/queries";
import { format, fromDayKey } from "@/lib/time";
import { BarList, ChartCard, ColumnChart, Heatmap, PairedBars, fmtInt, fmtPct } from "@/components/charts/Charts";
import { Button } from "@/components/ui/Button";
import { ErrorState, Skeleton } from "@/components/ui/Primitives";
import { AdminHeader } from "@/layouts/AdminLayout";
import { Delta, Kpi, downloadCsv, useUrlFilters } from "./shared";
import { L, N, t as tr } from "@/i18n";

const RANGES = [7, 30, 90] as const;

export default function AnalyticsPage() {
  const { get, patch } = useUrlFilters();
  const days = (RANGES as readonly number[]).includes(Number(get("days"))) ? Number(get("days")) : 30;
  const q = useAnalytics(days);
  const d = q.data;
  const t = d?.totals;
  const noShowRate = t && t.bookings ? t.noShows / t.bookings : 0;
  const cancelRate = t && t.bookings + t.cancellations ? t.cancellations / (t.bookings + t.cancellations) : 0;
  const tickEvery = days <= 7 ? 1 : days <= 30 ? 5 : 14;

  return (
    <div>
      <AdminHeader
        title={tr("Analytics")}
        description={tr("How campus spaces are used — demand, fairness and reliability over time.")}
        actions={
          <>
            <div className="inline-flex h-9 rounded-xl bg-surface-2 p-1" role="group" aria-label={tr("Date range")}>
              {RANGES.map((r) => (
                <button key={r} type="button" aria-pressed={days === r} onClick={() => patch({ days: r === 30 ? null : r })} className={cn("rounded-lg px-3 text-xs font-semibold", days === r ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
                  {r}{" "}{tr("days")}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="secondary"
              icon={<Download className="size-4" />}
              disabled={!d}
              onClick={() => d && downloadCsv(`analytics-${days}d.csv`, ["Day", "Booked", "Attended", "No-shows", "Cancellations"], d.daily.map((x) => [x.day, x.booked, x.attended, x.noShows, x.cancellations]))}
            >
              {tr("Export")}
            </Button>
          </>
        }
      />

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className={cn("space-y-6 transition-opacity", q.isPlaceholderData && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {!d || !t ? (
              Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[112px] rounded-[20px]" />)
            ) : (
              <>
                <Kpi label={tr("Sessions booked")} value={fmtInt(t.bookings)} delta={<Delta now={t.bookings} prev={d.prevTotals.bookings} />} hint={tr("vs previous {days} days", { days })} />
                <Kpi label={tr("Utilisation")} value={fmtPct(t.utilization)} delta={<Delta now={t.utilization} prev={d.prevTotals.utilization} unit="pts" />} />
                <Kpi label={tr("No-show rate")} tone={noShowRate > 0.06 ? "danger" : undefined} value={fmtPct(noShowRate, 1)} delta={<Delta now={noShowRate} prev={d.prevTotals.noShowRate} unit="pts" goodWhen="down" />} />
                <Kpi label={tr("Cancellation rate")} value={fmtPct(cancelRate, 1)} delta={<Delta now={cancelRate} prev={d.prevTotals.cancellationRate} unit="pts" goodWhen="down" />} />
                <Kpi label={tr("Students who booked")} value={fmtInt(t.uniqueStudents)} hint={tr("{v} sessions each", { v: t.uniqueStudents ? (t.bookings / t.uniqueStudents).toFixed(1) : 0 })} />
                <Kpi label={tr("Booked ahead")} value={t.avgLeadHours >= 24 ? `${(t.avgLeadHours / 24).toFixed(1)} d` : `${Math.round(t.avgLeadHours)} h`} hint={tr("{int} waitlist joins", { int: fmtInt(t.waitlistJoins) })} />
              </>
            )}
          </div>

          {d && d.insights.length > 0 && (
            <section className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label={tr("Insights")}>
              {d.insights.map((i) => (
                <p key={i.text} className={cn("flex gap-3 rounded-2xl border p-4 text-sm leading-relaxed text-ink-2", i.tone === "warning" ? "border-warning/25 bg-warning-soft" : i.tone === "success" ? "border-success/25 bg-success-soft" : "border-line bg-surface")}>
                  {i.tone === "warning" ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" /> : i.tone === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <Info className="mt-0.5 size-4 shrink-0 text-info" />}
                  {i.text}
                </p>
              ))}
            </section>
          )}

          {!d ? (
            <Skeleton className="h-72 rounded-[20px]" />
          ) : (
            <ChartCard title={tr("Sessions booked per day")} subtitle={tr("Includes sessions that were attended, missed or are still upcoming.")} table={{ columns: [tr("Day"), tr("Booked"), tr("Attended"), tr("No-shows"), tr("Cancelled")], rows: d.daily.map((x) => [format(fromDayKey(x.day), "EEE d MMM"), x.booked, x.attended, x.noShows, x.cancellations]) }}>
              <ColumnChart
                ariaLabel={tr("Sessions booked per day")}
                height={200}
                data={d.daily.map((x, i) => ({
                  label: format(fromDayKey(x.day), "EEEE d MMM"),
                  tick: (d.daily.length - 1 - i) % tickEvery === 0 ? format(fromDayKey(x.day), days <= 7 ? "EEE" : "d MMM") : undefined,
                  value: x.booked,
                  detail: tr("{a} attended · {b} no-shows · {c} cancelled", { a: x.attended, b: x.noShows, c: x.cancellations }),
                }))}
              />
            </ChartCard>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {!d ? (
              <Skeleton className="h-96 rounded-[20px]" />
            ) : (
              <ChartCard title={tr("Utilisation by facility")} subtitle={tr("Share of bookable capacity that was booked.")} table={{ columns: [tr("Facility"), tr("Utilisation"), tr("Bookings"), tr("No-show rate"), tr("Waitlist joins")], rows: d.byFacility.map((f) => [f.name, fmtPct(f.utilization), f.bookings, fmtPct(f.noShowRate, 1), f.waitlist]) }}>
                <BarList ariaLabel={tr("Utilisation by facility")} max={1} rows={d.byFacility.map((f) => ({ key: f.facilityId, label: f.name, sub: `${N.booking(f.bookings)}${f.waitlist ? ` · ${tr("{int} waitlist joins", { int: f.waitlist })}` : ""}`, value: f.utilization }))} />
              </ChartCard>
            )}
            {!d ? (
              <Skeleton className="h-96 rounded-[20px]" />
            ) : (
              <ChartCard title={tr("Reliability by facility type")} subtitle={tr("Where sessions go unused — missed or cancelled.")} table={{ columns: [tr("Type"), tr("Bookings"), tr("No-show rate"), tr("Cancellation rate")], rows: d.byCategory.map((c) => [c.name, c.bookings, fmtPct(c.noShowRate, 1), fmtPct(c.cancellationRate, 1)]) }}>
                <PairedBars ariaLabel={tr("Reliability by facility type")} series={[tr("No-show rate"), tr("Cancellation rate")]} format={(n) => fmtPct(n, 1)} rows={d.byCategory.map((c) => ({ key: c.categoryId, label: c.name, a: c.noShowRate, b: c.cancellationRate }))} />
              </ChartCard>
            )}
          </div>

          {!d ? (
            <Skeleton className="h-64 rounded-[20px]" />
          ) : (
            <ChartCard title={tr("Demand by weekday and hour")} subtitle={tr("Share of capacity booked, last {days} days.", { days })}>
              <Heatmap cells={d.heatmap} ariaLabel={tr("Demand by weekday and hour")} />
            </ChartCard>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {!d ? (
              <Skeleton className="h-64 rounded-[20px]" />
            ) : (
              <ChartCard title={tr("Bookings by start time")} subtitle={tr("Which hours students book most.")} table={{ columns: [tr("Hour"), tr("Bookings")], rows: d.byHour.map((v, h) => [`${String(h).padStart(2, "0")}:00`, v]).filter((r) => (r[1] as number) > 0) }}>
                <ColumnChart ariaLabel={tr("Bookings by start time")} data={d.byHour.slice(6).map((v, i) => ({ label: `${String(i + 6).padStart(2, "0")}:00`, tick: (i + 6) % 3 === 0 ? String(i + 6).padStart(2, "0") : undefined, value: v }))} />
              </ChartCard>
            )}
            {!d ? (
              <Skeleton className="h-64 rounded-[20px]" />
            ) : (
              <ChartCard title={tr("How often students book")} subtitle={tr("Students grouped by sessions booked in this period — a long tail means a few students take most slots.")} table={{ columns: [tr("Sessions"), tr("Students")], rows: d.studentDistribution.map((b) => [b.bucket, b.students]) }}>
                <ColumnChart ariaLabel={tr("How often students book")} data={d.studentDistribution.map((b) => ({ label: L(`${b.bucket} ${b.bucket === "1" ? "session" : "sessions"}`, `المواعيد: ${b.bucket}`), tick: b.bucket, value: b.students }))} />
              </ChartCard>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
