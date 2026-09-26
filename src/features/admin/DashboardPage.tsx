import { Link } from "react-router";
import { motion } from "motion/react";
import { Activity, AlertTriangle, ArrowRight, Building2, CalendarCheck, Info, ListOrdered, ShieldAlert, UserX } from "lucide-react";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { useAdminDashboard } from "@/lib/queries";
import { fmtAgo, fmtDayLong, format, fromDayKey, greeting } from "@/lib/time";
import { useSession } from "@/state/session";
import { BarList, ChartCard, ColumnChart, Heatmap, fmtPct } from "@/components/charts/Charts";
import { Avatar, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { AdminHeader } from "@/layouts/AdminLayout";
import { Delta, Kpi } from "./shared";
import { L, N, t as tr } from "@/i18n";

const TONE = {
  danger: { icon: ShieldAlert, cls: "bg-danger-soft text-danger" },
  warning: { icon: AlertTriangle, cls: "bg-warning-soft text-warning" },
  info: { icon: Info, cls: "bg-info-soft text-info" },
};

export default function DashboardPage() {
  const now = useNow(60000);
  const user = useSession((s) => s.user)!;
  const q = useAdminDashboard();

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} className="mt-10" />;
  const d = q.data;
  const k = d?.kpis;

  return (
    <div>
      <AdminHeader
        title={`${greeting(now)}${L(", ", "، ")}${user.name.split(" ")[0]}`}
        description={tr("{dayLong} · live across {v} facilities", { dayLong: fmtDayLong(now), v: k ? k.facilities.total : "…" })}
        actions={
          <Link to="/admin/analytics" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-brand hover:bg-brand-soft">
            {tr("Full analytics")}{" "}<ArrowRight className="size-4" />
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {!k ? (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[112px] rounded-[20px]" />)
        ) : (
          <>
            <Kpi label={tr("Bookings today")} icon={<CalendarCheck />} value={k.today.bookings} hint={tr("{checkedIn} in · {upcoming} to come", { checkedIn: k.today.checkedIn, upcoming: k.today.upcoming })} to="/admin/bookings?range=today" />
            <Kpi label={tr("In use now")} icon={<Activity />} value={k.activeNow} hint={tr("checked in right now")} />
            <Kpi label={tr("Utilisation, 7 days")} value={fmtPct(k.utilization.last7d)} delta={<Delta now={k.utilization.last7d} prev={k.utilization.prev7d} unit="pts" />} hint={tr("vs previous week")} />
            <Kpi label={tr("No-show rate, 7 days")} icon={<UserX />} tone={k.noShows.rate7d > 0.06 ? "danger" : undefined} value={fmtPct(k.noShows.rate7d, 1)} delta={<Delta now={k.noShows.rate7d} prev={k.noShows.ratePrev7d} unit="pts" goodWhen="down" />} hint={tr("{today} today", { today: k.noShows.today })} />
            <Kpi label={tr("Waiting for a spot")} icon={<ListOrdered />} value={k.waitlist.waiting} hint={tr("{offers} open", { offers: N.offer(k.waitlist.offered) })} to="/admin/waitlists" />
            <Kpi label={tr("Facilities open")} icon={<Building2 />} value={`${k.facilities.active}/${k.facilities.total}`} tone={k.facilities.maintenance ? "warning" : undefined} hint={k.facilities.maintenance ? tr("{n} under maintenance", { n: k.facilities.maintenance }) : tr("none under maintenance")} to="/admin/facilities" />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {!d ? (
            <Skeleton className="h-72 rounded-[20px]" />
          ) : (
            <ChartCard
              title={tr("Bookings, last 14 days")}
              subtitle={tr("Sessions booked per day across campus. Today is underlined.")}
              table={{ columns: [tr("Day"), tr("Booked"), tr("No-shows"), tr("Cancelled")], rows: d.bookingsTrend.map((t) => [format(fromDayKey(t.day), "EEE d MMM"), t.booked, t.noShows, t.cancelled]) }}
            >
              <ColumnChart
                ariaLabel={tr("Bookings per day over the last 14 days")}
                highlight={d.bookingsTrend.length - 1}
                data={d.bookingsTrend.map((t, i) => ({
                  label: format(fromDayKey(t.day), "EEEE d MMM"),
                  tick: (d.bookingsTrend.length - 1 - i) % 2 === 0 ? format(fromDayKey(t.day), "d") : undefined,
                  value: t.booked,
                  detail: tr("{a} no-shows · {b} cancelled", { a: t.noShows, b: t.cancelled }),
                }))}
              />
            </ChartCard>
          )}
          {!d ? (
            <Skeleton className="h-64 rounded-[20px]" />
          ) : (
            <ChartCard title={tr("When campus is busiest")} subtitle={tr("Share of capacity booked by weekday and hour, last 4 weeks.")}>
              <Heatmap cells={d.heatmap} ariaLabel={tr("Booking demand by weekday and hour")} />
            </ChartCard>
          )}
        </div>

        <div className="space-y-6">
          <section className="rounded-[20px] border border-line bg-surface p-5 shadow-sm">
            <h3 className="text-[15px] font-bold text-ink">{tr("Needs attention")}</h3>
            {!d ? (
              <div className="mt-4 space-y-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            ) : d.attention.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{tr("All clear — nothing waiting on you.")}</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {d.attention.map((a, i) => {
                  const t = TONE[a.tone];
                  return (
                    <motion.li key={a.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                      <Link to={a.link} className="group flex gap-3 rounded-2xl p-2.5 transition-colors hover:bg-surface-2">
                        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", t.cls)}>
                          <t.icon className="size-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-ink first-letter:uppercase">{a.title}</span>
                          <span className="line-clamp-2 block text-xs text-muted">{a.detail}</span>
                        </span>
                        <ArrowRight className="mt-2 size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </section>

          {!d ? (
            <Skeleton className="h-72 rounded-[20px]" />
          ) : (
            <ChartCard title={tr("Utilisation by facility")} subtitle={tr("Last 7 days")} table={{ columns: [tr("Facility"), tr("Utilisation")], rows: d.utilizationByFacility.map((f) => [f.name, fmtPct(f.value)]) }}>
              <BarList ariaLabel={tr("Utilisation by facility")} max={1} rows={d.utilizationByFacility.slice(0, 8).map((f) => ({ key: f.facilityId, label: f.name, value: f.value }))} />
              {d.utilizationByFacility.length > 8 && (
                <Link to="/admin/analytics" className="mt-3 inline-block text-xs font-semibold text-brand hover:underline">
                  {tr("See all")}{" "}{d.utilizationByFacility.length}
                </Link>
              )}
            </ChartCard>
          )}

          <section className="rounded-[20px] border border-line bg-surface p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-ink">{tr("Recent activity")}</h3>
              <Link to="/admin/audit" className="text-xs font-semibold text-brand hover:underline">
                {tr("Audit log")}
              </Link>
            </div>
            {!d ? (
              <Skeleton className="mt-4 h-48" />
            ) : (
              <ul className="mt-3 space-y-3">
                {d.activity.slice(0, 7).map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <Avatar name={a.actorName} hue={a.actorId === "system" ? 210 : (a.actorName.charCodeAt(0) * 37) % 360} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-snug text-ink-2">{a.summary}</p>
                      <p className="text-[11px] text-faint">
                        {a.actorName} · {fmtAgo(a.at, now)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
