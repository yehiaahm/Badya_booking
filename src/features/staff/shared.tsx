import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Brush, DoorClosed, Lightbulb, Lock, ShieldAlert, Wrench, type LucideIcon } from "lucide-react";
import { api, type StaffFacilityToday, type StaffOverview } from "@/api";
import type { FacilityIssue, IssueCategory } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { errorMessage } from "@/lib/queries";
import { addMinutes, fmtAgo, fmtTime, overlaps } from "@/lib/time";
import { useCan } from "@/state/session";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Form";
import { Badge } from "@/components/ui/Primitives";
import { Dialog } from "@/components/ui/Overlay";
import { toast } from "@/components/ui/Toast";
import { L, N, arCount, t } from "@/i18n";

/* ───────────── Selected facility ───────────── */

const KEY = "bs-staff-facility";

/** The facility a staff member is working at — kept in the URL and remembered between visits. */
export function useStaffFacility(overview: StaffOverview | undefined) {
  const [params, setParams] = useSearchParams();
  const ids = overview?.facilities.map((f) => f.facility.id) ?? [];
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(KEY);
  } catch {
    /* private mode */
  }
  const wanted = params.get("f") ?? remembered;
  const id = wanted && ids.includes(wanted) ? wanted : ids[0];
  const current = overview?.facilities.find((f) => f.facility.id === id);
  const select = (next: string) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode */
    }
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("f", next);
        return n;
      },
      { replace: true },
    );
  };
  return { current, select };
}

export function FacilityPicker({ overview, value, onChange, tone = "default" }: { overview: StaffOverview; value?: string; onChange: (id: string) => void; tone?: "default" | "dark" }) {
  if (overview.facilities.length < 2) return null;
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label={t("Facility")}>
      {overview.facilities.map((f) => {
        const on = f.facility.id === value;
        return (
          <button
            key={f.facility.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(f.facility.id)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition-colors",
              tone === "dark" ? (on ? "bg-white text-dusk" : "bg-white/10 text-white/80 hover:bg-white/15") : on ? "bg-ink text-bg" : "border border-line bg-surface text-ink-2 hover:border-line-strong",
            )}
          >
            <span className="size-2 rounded-full" style={{ background: f.category.color }} />
            {f.facility.name}
            {f.issues.length > 0 && <span className={cn("rounded-full px-1.5 text-[11px] font-bold", on && tone !== "dark" ? "bg-warning text-white" : "bg-warning-soft text-warning")}>{f.issues.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────── Issues ───────────── */

export const ISSUE_CATEGORIES: Record<IssueCategory, { label: string; icon: LucideIcon }> = {
  equipment: { get label() {
    return t("Equipment");
  }, icon: Wrench },
  cleanliness: { get label() {
    return t("Cleanliness");
  }, icon: Brush },
  safety: { get label() {
    return t("Safety");
  }, icon: ShieldAlert },
  lighting: { get label() {
    return t("Lighting");
  }, icon: Lightbulb },
  access: { get label() {
    return t("Access");
  }, icon: Lock },
  other: { get label() {
    return t("Other");
  }, icon: AlertTriangle },
};

const SEVERITY: Record<FacilityIssue["severity"], { label: string; tone: "neutral" | "warning" | "danger" }> = {
  low: { get label() {
    return t("Low");
  }, tone: "neutral" },
  medium: { get label() {
    return t("Medium");
  }, tone: "warning" },
  high: { get label() {
    return t("High");
  }, tone: "danger" },
};

export function ReportIssueDialog({ facility, open, onClose }: { facility: StaffFacilityToday | undefined; open: boolean; onClose: () => void }) {
  const [category, setCategory] = useState<IssueCategory>("equipment");
  const [severity, setSeverity] = useState<FacilityIssue["severity"]>("medium");
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (open) {
      setCategory("equipment");
      setSeverity("medium");
      setDescription("");
    }
  }, [open]);
  const report = useMutation({
    mutationFn: () => api.staff.reportIssue({ facilityId: facility!.facility.id, category, severity, description }),
    onSuccess: (i) => {
      toast.success(t("Issue reported"), t("{id} was sent to the facilities office.", { id: i.id }));
      onClose();
    },
  });
  const tooShort = description.trim().length < 8;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("Report an issue")}
      description={facility?.facility.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => report.mutate()} loading={report.isPending} disabled={tooShort}>
            {t("Send report")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-ink">{t("What kind of problem?")}</legend>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(ISSUE_CATEGORIES) as IssueCategory[]).map((c) => {
              const { label, icon: I } = ISSUE_CATEGORIES[c];
              return (
                <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={cn("flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-xs font-semibold transition-colors", category === c ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-ink-2 hover:border-line-strong")}>
                  <I className="size-5" /> {label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-ink">{t("How urgent?")}</legend>
          <div className="inline-flex rounded-xl bg-surface-2 p-1">
            {(Object.keys(SEVERITY) as FacilityIssue["severity"][]).map((s) => (
              <button key={s} type="button" aria-pressed={severity === s} onClick={() => setSeverity(s)} className={cn("h-8 rounded-lg px-4 text-xs font-semibold", severity === s ? cn("bg-surface shadow-sm", s === "high" ? "text-danger" : s === "medium" ? "text-warning" : "text-ink") : "text-muted hover:text-ink")}>
                {SEVERITY[s].label}
              </button>
            ))}
          </div>
          {severity === "high" && <p className="mt-2 text-xs text-danger">{t("If anyone is at risk, close the facility too — then call campus security.")}</p>}
        </fieldset>
        <Field label={t("What’s wrong?")} htmlFor="issue-desc" hint={t("Where exactly, and what you’ve already tried.")} error={report.isError ? errorMessage(report.error) : undefined}>
          <Textarea id="issue-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("e.g. Left goal net is torn at the bottom corner")} maxLength={500} />
        </Field>
      </div>
    </Dialog>
  );
}

export function IssueList({ issues }: { issues: FacilityIssue[] }) {
  const now = useNow(60000);
  const update = useMutation({
    mutationFn: (v: { id: string; status: FacilityIssue["status"] }) => api.staff.updateIssue(v.id, v.status),
    onSuccess: (i) => toast.success(i.status === "resolved" ? t("Marked as resolved") : t("Marked as in progress")),
    onError: (e) => toast.error(t("Couldn’t update"), errorMessage(e)),
  });
  if (!issues.length) return <p className="rounded-2xl bg-surface-2/70 p-4 text-sm text-muted">{t("No open issues. Report one if something needs fixing.")}</p>;
  return (
    <ul className="space-y-2">
      {issues.map((i) => {
        const { icon: I, label } = ISSUE_CATEGORIES[i.category];
        const busy = update.isPending && update.variables?.id === i.id;
        return (
          <li key={i.id} className="flex gap-3 rounded-2xl border border-line bg-surface p-3">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", i.severity === "high" ? "bg-danger-soft text-danger" : i.severity === "medium" ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted")}>
              <I className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{i.description}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <span>{label}</span>·<span>{fmtAgo(i.createdAt, now)}</span>
                <Badge size="xs" tone={SEVERITY[i.severity].tone}>
                  {SEVERITY[i.severity].label}
                </Badge>
                {i.status === "in_progress" && (
                  <Badge size="xs" tone="info">
                    {t("In progress")}
                  </Badge>
                )}
              </p>
              <div className="mt-2 flex gap-1.5">
                {i.status === "open" && (
                  <Button size="xs" variant="secondary" disabled={busy} onClick={() => update.mutate({ id: i.id, status: "in_progress" })}>
                    {t("Start work")}
                  </Button>
                )}
                <Button size="xs" variant="soft" loading={busy} onClick={() => update.mutate({ id: i.id, status: "resolved" })}>
                  {t("Resolve")}
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────────── Temporary closure ───────────── */

const DURATIONS = [30, 60, 120, 240];
const REASONS = () => [t("Wet or slippery surface"), t("Equipment failure"), t("Cleaning in progress"), t("Power or lighting outage"), t("Safety concern")];

export function CloseDialog({ facility, open, onClose }: { facility: StaffFacilityToday | undefined; open: boolean; onClose: () => void }) {
  const now = useNow(30000);
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) {
      setMinutes(60);
      setReason("");
    }
  }, [open]);
  const until = addMinutes(now, minutes);
  // Same rule the backend applies: confirmed or pending bookings that overlap the closure.
  const inWindow = (facility?.sessions ?? []).flatMap((s) => s.bookings).filter((b) => overlaps(now.getTime(), until.getTime(), new Date(b.start).getTime(), new Date(b.end).getTime()));
  const affected = inWindow.filter((b) => b.status === "CONFIRMED" || b.status === "PENDING");
  // Checked-in groups are already on site — the closure doesn't cancel them.
  const onSite = inWindow.filter((b) => b.status === "CHECKED_IN").length;
  const close = useMutation({
    mutationFn: () => api.staff.closeTemporarily({ facilityId: facility!.facility.id, minutes, reason }),
    onSuccess: (m) => {
      toast.success(t("{name} closed until {time}", { name: facility?.facility.name, time: fmtTime(m.end) }), m.affectedBookingIds.length ? t("{bookings} cancelled without penalty. Students have been notified.", { bookings: N.booking(m.affectedBookingIds.length) }) : t("No bookings were affected."));
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("Close temporarily")}
      description={t("{name} stops taking bookings right away.", { name: facility?.facility.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="danger" icon={<DoorClosed className="size-4" />} onClick={() => close.mutate()} loading={close.isPending} disabled={reason.trim().length < 4}>
            {t("Close until")}{" "}{fmtTime(until)}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-ink">{t("For how long?")}</legend>
          <div className="grid grid-cols-4 gap-2">
            {DURATIONS.map((d) => (
              <button key={d} type="button" aria-pressed={minutes === d} onClick={() => setMinutes(d)} className={cn("h-11 rounded-xl border text-sm font-semibold", minutes === d ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-ink-2 hover:border-line-strong")}>
                {d < 60 ? L(`${d} min`, `${d} دقيقة`) : L(`${d / 60} h`, arCount(d / 60, "ساعة", "ساعتين", "ساعات", "ساعة"))}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label={t("Reason")} htmlFor="close-reason" hint={t("Students see this in their cancellation notice.")} error={close.isError ? errorMessage(close.error) : undefined}>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {REASONS().map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={cn("h-7 rounded-full border px-2.5 text-xs font-semibold", reason === r ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-muted hover:text-ink")}>
                {r}
              </button>
            ))}
          </div>
          <Textarea id="close-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16" maxLength={200} />
        </Field>
        <div className={cn("flex gap-3 rounded-2xl p-3.5 text-sm", affected.length || onSite ? "bg-warning-soft" : "bg-surface-2")}>
          <AlertTriangle className={cn("mt-0.5 size-5 shrink-0", affected.length || onSite ? "text-warning" : "text-muted")} />
          <p className="text-ink-2">
            {affected.length ? (
              <>
                <span className="font-bold text-ink">
                  {t("{bookings} will be cancelled", { bookings: N.booking(affected.length) })}
                </span>{" "}
                {t("without a strike, and everyone on them is notified. Waitlists for these sessions are cleared.")}
              </>
            ) : (
              t("No upcoming bookings are affected.")
            )}
            {onSite > 0 && ` ${t("{groups} checked in right now — let them know in person.", { groups: N.group(onSite) })}`}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

/** Report / close / reopen buttons for a facility, gated by permission. */
export function FacilityActions({ facility, onReport, onClose, size = "sm" }: { facility: StaffFacilityToday; onReport: () => void; onClose: () => void; size?: "xs" | "sm" }) {
  const canReport = useCan("facility.report_issue");
  const canClose = useCan("facility.close_temporarily");
  const now = useNow(30000);
  const closure = facility.maintenance.find((m) => new Date(m.start) <= now && new Date(m.end) > now);
  const reopen = useMutation({
    mutationFn: (id: string) => api.staff.reopen(id),
    onSuccess: () => toast.success(t("{name} reopened", { name: facility.facility.name }), t("New bookings can be made again.")),
    onError: (e) => toast.error(t("Couldn’t reopen"), errorMessage(e)),
  });
  return (
    <div className="flex flex-wrap gap-2">
      {canReport && (
        <Button size={size} variant="secondary" icon={<Wrench className="size-4" />} onClick={onReport}>
          {t("Report issue")}
        </Button>
      )}
      {canClose &&
        (closure ? (
          // Staff can lift their own closures; planned maintenance is the office's call.
          closure.kind === "staff_closure" ? (
            <Button size={size} variant="soft" loading={reopen.isPending} onClick={() => reopen.mutate(closure.id)}>
              {t("Reopen now")}
            </Button>
          ) : (
            <Badge tone="warning" icon={<Wrench className="size-3.5" />}>
              {t("Maintenance until")}{" "}{fmtTime(closure.end)}
            </Badge>
          )
        ) : (
          facility.facility.status === "active" && (
            <Button size={size} variant="danger-soft" icon={<DoorClosed className="size-4" />} onClick={onClose}>
              {t("Close temporarily")}
            </Button>
          )
        ))}
    </div>
  );
}
