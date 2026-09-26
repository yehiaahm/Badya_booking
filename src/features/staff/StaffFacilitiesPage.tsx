import { useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { Building2, ChevronRight, MapPin, Wrench } from "lucide-react";
import type { StaffFacilityToday } from "@/api";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { useStaffOverview } from "@/lib/queries";
import { fmtTime } from "@/lib/time";
import { FacilityArt } from "@/components/facility/FacilityArt";
import { locationLabel } from "@/components/facility/FacilityCard";
import { Badge, Card, EmptyState, ErrorState, ProgressBar, Skeleton } from "@/components/ui/Primitives";
import { CloseDialog, FacilityActions, IssueList, ReportIssueDialog } from "./shared";
import { N, t } from "@/i18n";

function statusOf(f: StaffFacilityToday, now: Date) {
  if (f.facility.status !== "active") return { label: t("Closed"), tone: "danger" as const, detail: f.facility.inactiveReason };
  const m = f.maintenance.find((x) => new Date(x.start) <= now && new Date(x.end) > now);
  if (m) return { label: m.kind === "staff_closure" ? t("Closed temporarily") : t("Maintenance"), tone: "warning" as const, detail: t("{reason} · until {time}", { reason: m.reason, time: fmtTime(m.end) }) };
  if (f.occupancyNow?.taken) return { label: t("In session"), tone: "success" as const, detail: t("{n} checked in · {taken}/{capacity} booked", { n: f.occupancyNow.checkedIn, taken: f.occupancyNow.taken, capacity: f.occupancyNow.capacity }) };
  const next = f.sessions.find((s) => s.state === "next");
  const upcoming = next ? t("Next session {time}", { time: fmtTime(next.start) }) : t("No more sessions today");
  return { label: t("Open"), tone: "neutral" as const, detail: f.occupancyNow ? t("Free right now · {next}", { next: upcoming }) : upcoming };
}

export function StaffFacilitiesPage() {
  const now = useNow(30000);
  const q = useStaffOverview();
  const [dialog, setDialog] = useState<{ kind: "report" | "close"; id: string } | null>(null);
  const target = q.data?.facilities.find((f) => f.facility.id === dialog?.id);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} className="mt-10" />;

  const issues = (q.data?.facilities ?? []).reduce((n, f) => n + f.issues.length, 0);

  return (
    <div className="pt-6 sm:pt-8">
      <h1 className="font-display text-[34px] leading-none text-ink sm:text-[40px]">{t("Facilities")}</h1>
      <p className="mt-2 text-sm text-muted">{q.data ? t("{n} you look after · {issues} open", { n: q.data.facilities.length, issues: N.issue(issues) }) : " "}</p>

      {!q.data ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-72 rounded-[22px]" />
          ))}
        </div>
      ) : q.data.facilities.length === 0 ? (
        <EmptyState icon={Building2} title={t("No facilities assigned to you")} body={t("Ask the facilities office to assign you to the spaces you supervise.")} className="mt-10" />
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {q.data.facilities.map((f, i) => {
            const st = statusOf(f, now);
            return (
              <motion.div key={f.facility.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Card className="flex h-full flex-col overflow-hidden">
                  <div className="flex gap-4 p-4">
                    <FacilityArt motif={f.facility.media.motif} accent={f.facility.media.accent} imageUrl={f.facility.media.imageUrl} className="size-20 shrink-0 rounded-2xl" dim={f.facility.status !== "active"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="truncate text-base font-bold text-ink">{f.facility.name}</h2>
                        <Badge size="xs" tone={st.tone} dot>
                          {st.label}
                        </Badge>
                      </div>
                      <p className="flex items-center gap-1 truncate text-xs text-muted">
                        <MapPin className="size-3 shrink-0" /> {locationLabel(f.facility)}
                      </p>
                      <p className={cn("mt-1.5 text-[13px] font-semibold", st.tone === "danger" ? "text-danger" : st.tone === "warning" ? "text-warning" : "text-ink-2")}>{st.detail}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-3 border-t border-line px-4 py-3 text-center">
                    {[
                      { label: t("Booked"), v: f.stats.booked },
                      { label: t("In"), v: f.stats.checkedIn },
                      { label: t("No-show"), v: f.stats.noShows },
                      { label: t("Used"), v: `${Math.round(f.stats.utilization * 100)}%` },
                    ].map((x) => (
                      <div key={x.label}>
                        <p className="text-lg font-bold text-ink tabular">{x.v}</p>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">{x.label}</p>
                      </div>
                    ))}
                  </div>
                  <ProgressBar value={f.stats.utilization} className="mx-4" label={t("{name} utilisation today", { name: f.facility.name })} />
                  <div className="flex-1 space-y-3 p-4">
                    {f.issues.length > 0 && (
                      <div>
                        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-faint">
                          <Wrench className="size-3.5" /> {t("{issues} open", { issues: N.issue(f.issues.length) })}
                        </p>
                        <IssueList issues={f.issues.slice(0, 2)} />
                        {f.issues.length > 2 && (
                          <Link to={`/staff?f=${f.facility.id}`} className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
                            {t("See all")}{" "}{f.issues.length}
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-3">
                    <FacilityActions facility={f} size="xs" onReport={() => setDialog({ kind: "report", id: f.facility.id })} onClose={() => setDialog({ kind: "close", id: f.facility.id })} />
                    <Link to={`/staff?f=${f.facility.id}`} className="inline-flex h-8 items-center gap-0.5 rounded-full px-3 text-xs font-bold text-ink-2 hover:bg-surface-2">
                      {t("Today’s schedule")}{" "}<ChevronRight className="size-3.5" />
                    </Link>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <ReportIssueDialog facility={target} open={dialog?.kind === "report"} onClose={() => setDialog(null)} />
      <CloseDialog facility={target} open={dialog?.kind === "close"} onClose={() => setDialog(null)} />
    </div>
  );
}
