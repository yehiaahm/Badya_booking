import { useState } from "react";
import { motion } from "motion/react";
import { useMutation } from "@tanstack/react-query";
import { Clock, ListOrdered, Send, Sparkles, X } from "lucide-react";
import { api, type WaitlistSessionView } from "@/api";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { errorMessage, useAdminWaitlists } from "@/lib/queries";
import { countdown, dayKey, fmtAgo, fmtRange, fmtDayShort, relDay } from "@/lib/time";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Form";
import { Avatar, Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { Dialog } from "@/components/ui/Overlay";
import { toast } from "@/components/ui/Toast";
import { AdminHeader } from "@/layouts/AdminLayout";
import { Kpi, useUrlFilters } from "./shared";
import { t } from "@/i18n";

type Entry = WaitlistSessionView["entries"][number];

function SessionCard({ s, onRemove }: { s: WaitlistSessionView; onRemove: (e: Entry, s: WaitlistSessionView) => void }) {
  const now = useNow(1000);
  const waiting = s.entries.filter((e) => e.status === "waiting").length;
  const offer = useMutation({
    mutationFn: () => api.admin.offerNextManually(s.facility.id, s.start),
    onSuccess: () => toast.success(t("Spot offered"), t("The next student has been notified.")),
    onError: (e) => toast.error(t("Couldn’t offer a spot"), errorMessage(e)),
  });
  return (
    <motion.article layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-[20px] border border-line bg-surface p-4 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: s.category.color }} />
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-bold text-ink">{s.facility.name}</h3>
            <p className="text-sm text-ink-2 tabular">
              {relDay(s.start, now)}, {fmtRange(s.start, s.end)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {s.remaining > 0 ? (
            <Badge tone="success" size="xs">
              {s.remaining}{" "}{t("free")}
            </Badge>
          ) : (
            <Badge size="xs">{t("Full")}</Badge>
          )}
          {s.remaining > 0 && waiting > 0 && (
            <Button size="xs" variant="soft" icon={<Send className="size-3.5" />} loading={offer.isPending} onClick={() => offer.mutate()}>
              {t("Offer next")}
            </Button>
          )}
        </div>
      </header>
      <ol className="mt-3 divide-y divide-line">
        {s.entries.map((e) => {
          const left = e.offerExpiresAt ? new Date(e.offerExpiresAt).getTime() - now.getTime() : 0;
          return (
            <li key={e.id} className="flex items-center gap-3 py-2">
              <span className="w-5 text-center text-xs font-bold text-faint tabular">{e.position}</span>
              <Avatar name={e.user.name} hue={e.user.avatarHue} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{e.user.name}</span>
                <span className="block text-xs text-muted">
                  {e.user.universityId}{" "}{t("· joined")}{" "}{fmtAgo(e.createdAt, now)}
                </span>
              </span>
              {e.status === "offered" ? (
                <Badge tone="brand" size="xs" icon={<Sparkles className="size-3" />}>
                  <span className="tabular">{t("Offered ·")}{" "}{left > 0 ? countdown(left) : "expiring"}</span>
                </Badge>
              ) : (
                <Badge tone="violet" size="xs">
                  {t("Waiting")}
                </Badge>
              )}
              <button type="button" onClick={() => onRemove(e, s)} aria-label={t("Remove {name} from the waitlist", { name: e.user.name })} className="flex size-7 items-center justify-center rounded-full text-faint hover:bg-danger-soft hover:text-danger">
                <X className="size-4" />
              </button>
            </li>
          );
        })}
      </ol>
    </motion.article>
  );
}

export default function WaitlistsPage() {
  const now = useNow(60000);
  const q = useAdminWaitlists();
  const { get, patch } = useUrlFilters();
  const [removing, setRemoving] = useState<{ e: Entry; s: WaitlistSessionView } | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.admin.removeWaitlistEntry(id),
    onSuccess: () => {
      toast.success(t("Removed from the waitlist"), removing?.e.status === "offered" ? t("Their offer moved to the next student.") : t("The student has been notified."));
      setRemoving(null);
    },
    onError: (e) => toast.error(t("Couldn’t remove"), errorMessage(e)),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} className="mt-10" />;
  const all = q.data ?? [];
  const facilityOptions = [...new Map(all.map((s) => [s.facility.id, s.facility.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const list = get("facility") ? all.filter((s) => s.facility.id === get("facility")) : all;
  const days = [...new Set(list.map((s) => dayKey(s.start)))];
  const waiting = all.reduce((n, s) => n + s.entries.filter((e) => e.status === "waiting").length, 0);
  const offered = all.reduce((n, s) => n + s.entries.filter((e) => e.status === "offered").length, 0);

  return (
    <div>
      <AdminHeader title={t("Waitlists")} description={t("Students queueing for full sessions. Freed spots are offered in order automatically — step in only when something needs a hand.")} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {!q.data ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-[20px]" />)
        ) : (
          <>
            <Kpi label={t("Sessions with a queue")} icon={<ListOrdered />} value={all.length} />
            <Kpi label={t("Students waiting")} value={waiting} />
            <Kpi label={t("Offers open")} icon={<Clock />} value={offered} hint={t("waiting to be claimed")} />
          </>
        )}
      </div>

      {facilityOptions.length > 1 && (
        <div className="mb-4 w-64">
          <Select aria-label={t("Facility")} value={get("facility")} onChange={(e) => patch({ facility: e.target.value })}>
            <option value="">{t("All facilities")}</option>
            {facilityOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {!q.data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-48 rounded-[20px]" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={ListOrdered} title={t("No one is waiting")} body={t("When a session fills up and students join its waitlist, the queue appears here.")} className="rounded-[20px] border border-line bg-surface" />
      ) : (
        <div className="space-y-8">
          {days.map((d) => {
            const items = list.filter((s) => dayKey(s.start) === d);
            return (
              <section key={d}>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-faint">
                  {relDay(items[0].start, now)}
                  {relDay(items[0].start, now) !== fmtDayShort(items[0].start) && <span className="ms-1.5 font-semibold normal-case tracking-normal">· {fmtDayShort(items[0].start)}</span>}
                </h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  {items.map((s) => (
                    <SessionCard key={`${s.facility.id}-${s.start}`} s={s} onRemove={(e, ss) => setRemoving({ e, s: ss })} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        size="sm"
        title={t("Remove {v}?", { v: removing?.e.user.name ?? "" })}
        description={removing ? `${removing.s.facility.name} · ${fmtDayShort(removing.s.start)}, ${fmtRange(removing.s.start, removing.s.end)}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              {t("Keep")}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.e.id)}>
              {t("Remove")}
            </Button>
          </>
        }
      >
        <p className={cn("text-sm text-ink-2")}>{removing?.e.status === "offered" ? t("They currently hold an offer. Removing them passes the spot to the next student straight away.") : t("They’ll be told they were removed from the queue. Everyone behind them moves up one place.")}</p>
      </Dialog>
    </div>
  );
}
