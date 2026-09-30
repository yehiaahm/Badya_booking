import { useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Megaphone, PauseCircle, Scale, XCircle } from "lucide-react";
import { api, type FlagView } from "@/api";
import type { FairnessFlagType } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { errorMessage, useFlags } from "@/lib/queries";
import { fmtAgo, fmtDayShort, fmtRange } from "@/lib/time";
import { StatusBadge } from "@/components/booking/status";
import { Button } from "@/components/ui/Button";
import { Avatar, Badge, EmptyState, ErrorState, Skeleton, Tabs } from "@/components/ui/Primitives";
import { toast } from "@/components/ui/Toast";
import { AdminHeader } from "@/layouts/AdminLayout";
import { ReasonDialog, useUrlFilters } from "./shared";
import { N, t } from "@/i18n";

const TYPE: Record<FairnessFlagType, () => string> = {
  linked_back_to_back: () => t("Linked group, back-to-back"),
  repeat_late_cancel: () => t("Repeated late cancellations"),
  noshow_pattern: () => t("No-show pattern"),
};
type Decision = "dismissed" | "warned" | "restricted";
const DECISION: Record<Decision, { title: string; confirm: string; body: string; variant: "primary" | "danger" | "secondary" }> = {
  dismissed: { get title() {
    return t("Dismiss this flag?");
  }, get confirm() {
    return t("Dismiss");
  }, get body() {
    return t("Nothing happens to the students. Use this when the pattern has an innocent explanation.");
  }, variant: "secondary" },
  warned: { get title() {
    return t("Warn these students?");
  }, get confirm() {
    return t("Send warning");
  }, get body() {
    return t("Each student gets a fair-use notice. No restriction is applied.");
  }, variant: "primary" },
  restricted: { get title() {
    return t("Pause booking for 7 days?");
  }, get confirm() {
    return t("Pause everyone for 7 days");
  }, get body() {
    return t("Every student in the group is paused from new bookings for 7 days and told why.");
  }, variant: "danger" },
};

function FlagCard({ f, onDecide }: { f: FlagView; onDecide: (f: FlagView, d: Decision) => void }) {
  const now = useNow(60000);
  const open = f.status === "open";
  const chain = [...f.bookings].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <motion.article layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("rounded-[20px] border bg-surface p-5 shadow-sm", open ? "border-warning/30" : "border-line")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
            <Badge size="xs" tone={open ? "warning" : "neutral"}>
              {TYPE[f.type]()}
            </Badge>
            {f.facility.name} · {fmtAgo(f.createdAt, now)}
          </p>
          <h3 className="mt-2 text-[15px] font-semibold leading-snug text-ink">{f.summary}</h3>
        </div>
        <span className="font-mono text-[11px] text-faint">{f.id}</span>
      </header>

      <dl className={cn("mt-4 grid gap-2 text-center", f.type === "linked_back_to_back" ? "grid-cols-3" : "grid-cols-2")}>
        {[
          ...(f.type === "linked_back_to_back" ? [{ label: t("Sessions shared"), v: f.evidence.sharedSessions }] : []),
          { label: t("Look-back"), v: `${f.evidence.lookbackDays} d` },
          { label: t("Occurrences"), v: f.evidence.occurrences },
        ].map((x) => (
          <div key={x.label} className="flex flex-col-reverse rounded-xl bg-surface-2/70 px-2 py-2">
            <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{x.label}</dt>
            <dd className="text-base font-bold text-ink tabular">{x.v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-faint">{t("Students (")}{f.users.length})</h4>
          <ul className="space-y-1">
            {f.users.map((u) => (
              <li key={u.id}>
                <Link to={`/admin/students?open=${u.id}`} className="flex items-center gap-2.5 rounded-xl p-1 hover:bg-surface-2">
                  <Avatar name={u.name} hue={u.avatarHue} size={26} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{u.name}</span>
                  <span className="text-xs text-muted tabular">{u.universityId}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-faint">{t("Bookings")}</h4>
          <ol className="relative space-y-2 ps-4">
            <span className="absolute bottom-2 start-[5px] top-2 w-px bg-line" aria-hidden />
            {chain.map((b) => (
              <li key={b.id} className="relative text-sm">
                <span className="absolute -start-4 top-1.5 size-[11px] rounded-full border-2 border-surface bg-warning" />
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="font-semibold text-ink tabular">
                    {fmtDayShort(b.start)} {fmtRange(b.start, b.end)}
                  </span>
                  <StatusBadge status={b.status} size="xs" />
                </span>
                <span className="block text-xs text-muted">
                  {t("by")}{" "}{b.booker.name}
                  {b.unitName ? ` · ${b.unitName}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {open ? (
        <footer className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button size="sm" variant="ghost" icon={<XCircle className="size-4" />} onClick={() => onDecide(f, "dismissed")}>
            {t("Dismiss")}
          </Button>
          <Button size="sm" variant="secondary" icon={<Megaphone className="size-4" />} onClick={() => onDecide(f, "warned")}>
            {t("Warn students")}
          </Button>
          <Button size="sm" variant="danger-soft" icon={<PauseCircle className="size-4" />} onClick={() => onDecide(f, "restricted")}>
            {t("Pause 7 days")}
          </Button>
        </footer>
      ) : (
        f.resolution && (
          <p className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-sm text-ink-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <span>
              {f.resolution.action === "dismissed" ? t("Dismissed") : f.resolution.action === "warned" ? t("Students warned") : t("Students paused for 7 days")} · {fmtDayShort(f.resolution.at)}
              {f.resolution.note && ` — ${f.resolution.note}`}
            </span>
          </p>
        )
      )}
    </motion.article>
  );
}

export default function FairnessPage() {
  const q = useFlags();
  const { get, patch } = useUrlFilters();
  const tab = get("tab") === "resolved" ? "resolved" : "open";
  const [pending, setPending] = useState<{ f: FlagView; d: Decision } | null>(null);
  const resolve = useMutation({
    mutationFn: ({ f, d, note }: { f: FlagView; d: Decision; note: string }) => api.admin.resolveFlag(f.id, d, note),
    onSuccess: (_r, { d, f }) => {
      toast.success(d === "dismissed" ? t("Flag dismissed") : d === "warned" ? t("Warning sent") : t("Students paused for 7 days"), d === "dismissed" ? undefined : t("{students} notified.", { students: N.student(f.users.length) }));
      setPending(null);
    },
  });

  const all = q.data ?? [];
  const openFlags = all.filter((f) => f.status === "open");
  const resolved = all.filter((f) => f.status !== "open");
  const list = tab === "resolved" ? resolved : openFlags;

  return (
    <div>
      <AdminHeader
        title={t("Fair use")}
        description={
          <>
            {t("Bookings the rule engine allowed but asked a person to look at — usually groups rotating accounts to hold a facility back-to-back. Detection is set in")}{" "}<Link to="/admin/policies" className="font-semibold text-brand hover:underline">{t("booking policies")}</Link>.
          </>
        }
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(v) => patch({ tab: v === "resolved" ? "resolved" : null })}
        items={[
          { value: "open", label: t("To review"), count: openFlags.length || undefined },
          { value: "resolved", label: t("Resolved") },
        ]}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-80 rounded-[20px]" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={Scale} title={tab === "open" ? t("Nothing to review") : t("No resolved flags yet")} body={tab === "open" ? t("No booking patterns are waiting for a decision.") : undefined} className="rounded-[20px] border border-line bg-surface" />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {list.map((f) => (
            <FlagCard key={f.id} f={f} onDecide={(ff, d) => setPending({ f: ff, d })} />
          ))}
        </div>
      )}

      <ReasonDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending ? DECISION[pending.d].title : ""}
        description={pending?.f.summary}
        confirmLabel={pending ? DECISION[pending.d].confirm : ""}
        variant={pending ? DECISION[pending.d].variant : "primary"}
        optional={pending?.d === "dismissed"}
        presets={pending?.d === "dismissed" ? [t("Regular team with a fixed slot"), t("Coincidence — different groups"), t("Approved club training")] : [t("Rotating accounts to hold the pitch"), t("Pattern continued after a warning")]}
        loading={resolve.isPending}
        error={resolve.isError ? errorMessage(resolve.error) : undefined}
        onConfirm={(note) => pending && resolve.mutate({ ...pending, note })}
      >
        {pending && <p className="text-sm text-ink-2">{DECISION[pending.d].body}</p>}
      </ReasonDialog>
    </div>
  );
}
