import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarPlus, Wrench } from "lucide-react";
import { api, type MaintenanceView } from "@/api";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/hooks";
import { errorMessage, useAdminFacilities, useMaintenance } from "@/lib/queries";
import { addMinutes, clock, fmtDayShort, fmtRange, format } from "@/lib/time";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Badge, EmptyState, ErrorState, Skeleton, Tabs, type Tone } from "@/components/ui/Primitives";
import { Dialog } from "@/components/ui/Overlay";
import { toast } from "@/components/ui/Toast";
import { AdminHeader } from "@/layouts/AdminLayout";
import { TableShell, td, th, useUrlFilters } from "./shared";
import { L, N, arCount, t } from "@/i18n";
import { facilityName } from "@/domain/localize";

const STATE: Record<MaintenanceView["state"], { label: string; tone: Tone }> = {
  active: { get label() {
    return t("Closed now");
  }, tone: "warning" },
  scheduled: { get label() {
    return t("Scheduled");
  }, tone: "info" },
  completed: { get label() {
    return t("Completed");
  }, tone: "neutral" },
  cancelled: { get label() {
    return t("Cancelled");
  }, tone: "neutral" },
};
const KIND: Record<MaintenanceView["kind"], () => string> = { planned: () => t("Planned"), emergency: () => t("Emergency"), staff_closure: () => t("Staff closure") };
const REASONS = () => [t("Surface resurfacing"), t("Deep cleaning"), t("Equipment servicing"), t("University event"), t("Electrical work")];

const local = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");
const windowLabel = (start: string, end: string) => (fmtDayShort(start) === fmtDayShort(end) ? `${fmtDayShort(start)}${L(", ", "، ")}${fmtRange(start, end)}` : `${fmtDayShort(start)} ${format(new Date(start), "HH:mm")} – ${fmtDayShort(end)} ${format(new Date(end), "HH:mm")}`);

function ScheduleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const facilities = useAdminFacilities();
  // Archived facilities can’t be scheduled.
  const live = useMemo(() => (facilities.data ?? []).filter((f) => !f.facility.archived), [facilities.data]);
  const [facilityId, setFacilityId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) return;
    const s = new Date(clock.now());
    s.setMinutes(0, 0, 0);
    const from = addMinutes(s, 24 * 60);
    setStart(local(from));
    setEnd(local(addMinutes(from, 180)));
    setReason("");
  }, [open]);
  useEffect(() => {
    if (open && !facilityId && live.length) setFacilityId(live[0].facility.id);
  }, [open, facilityId, live]);

  const valid = !!facilityId && !!start && !!end && new Date(end) > new Date(start);
  const key = useDebounced(`${facilityId}|${start}|${end}`, 300);
  const impact = useQuery({
    queryKey: ["admin", "maintenance-impact", key],
    queryFn: () => {
      const [f, s, e] = key.split("|");
      return api.admin.maintenanceImpact(f, new Date(s).toISOString(), new Date(e).toISOString());
    },
    enabled: open && valid,
  });
  const create = useMutation({
    mutationFn: () => api.admin.createMaintenance({ facilityId, start: new Date(start).toISOString(), end: new Date(end).toISOString(), reason }),
    onSuccess: (m) => {
      toast.success(t("Maintenance scheduled"), m.affectedBookingIds.length ? t("{bookings} cancelled without penalty. Students were notified.", { bookings: N.booking(m.affectedBookingIds.length) }) : t("No bookings were affected."));
      onClose();
    },
  });
  const n = impact.data?.bookings.length ?? 0;
  const people = impact.data?.bookings.reduce((sum, b) => sum + b.people.length + 1, 0) ?? 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("Schedule maintenance")}
      description={t("The facility is closed for booking during this window.")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant={n ? "danger" : "primary"} loading={create.isPending} disabled={!valid || reason.trim().length < 4 || impact.isFetching} onClick={() => create.mutate()}>
            {n ? t("Schedule & cancel {bookings}", { bookings: N.booking(n) }) : t("Schedule")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("Facility")} htmlFor="mt-facility">
          <Select id="mt-facility" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            {live.map((f) => (
              <option key={f.facility.id} value={f.facility.id}>
                {facilityName(f.facility)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("Starts")} htmlFor="mt-start">
            <Input id="mt-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t("Ends")} htmlFor="mt-end" error={start && end && !valid ? t("Must be after the start.") : undefined}>
            <Input id="mt-end" type="datetime-local" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label={t("Reason")} htmlFor="mt-reason" hint={t("Students see this in their cancellation notice.")} error={create.isError ? errorMessage(create.error) : undefined}>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {REASONS().map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={cn("h-7 rounded-full border px-2.5 text-xs font-semibold", reason === r ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-muted hover:text-ink")}>
                {r}
              </button>
            ))}
          </div>
          <Textarea id="mt-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16" maxLength={200} />
        </Field>

        {valid && (
          <div className={cn("rounded-2xl p-3.5 text-sm", n ? "bg-warning-soft" : "bg-surface-2")} aria-live="polite">
            {impact.isFetching && !impact.data ? (
              <p className="text-muted">{t("Checking bookings in this window…")}</p>
            ) : (
              <>
                <p className="flex items-start gap-2 text-ink-2">
                  <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", n ? "text-warning" : "text-muted")} />
                  <span>
                    {n ? (
                      <>
                        <span className="font-bold text-ink">
                          {N.booking(n)} ({N.person(people)})
                        </span>{" "}
                        {t("will be cancelled without a strike, and everyone is notified.")}
                      </>
                    ) : (
                      t("No bookings fall in this window.")
                    )}
                    {impact.data?.waitlist ? ` ${L(`${impact.data.waitlist} waitlist ${impact.data.waitlist === 1 ? "entry" : "entries"} will be cleared.`, `وستُمسح ${arCount(impact.data.waitlist, "حجز انتظار واحد", "حجزا انتظار", "حجوزات انتظار", "حجز انتظار")} من قوائم الانتظار.`)}` : ""}
                  </span>
                </p>
                {n > 0 && (
                  <ul className="mt-2 space-y-0.5 ps-6 text-xs text-ink-2">
                    {impact.data!.bookings.slice(0, 5).map((b) => (
                      <li key={b.id} className="tabular">
                        {fmtDayShort(b.start)} {fmtRange(b.start, b.end)} · {b.booker.name}
                        {b.people.length ? ` +${b.people.length}` : ""}
                      </li>
                    ))}
                    {n > 5 && <li className="text-muted">{t("and")}{" "}{n - 5}{" "}{t("more")}</li>}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export default function MaintenancePage() {
  const q = useMaintenance();
  const { get, patch } = useUrlFilters();
  const tab = get("tab") === "past" ? "past" : "current";
  const [open, setOpen] = useState(false);
  const cancel = useMutation({
    mutationFn: (m: MaintenanceView) => api.admin.cancelMaintenance(m.id),
    onSuccess: (_r, m) => toast.success(m.state === "active" ? t("{name} reopened", { name: m.facility.name }) : t("Maintenance cancelled"), t("Sessions are bookable again.")),
    onError: (e) => toast.error(t("Couldn’t update"), errorMessage(e)),
  });

  const all = q.data ?? [];
  const current = all.filter((m) => m.state === "active" || m.state === "scheduled").sort((a, b) => a.start.localeCompare(b.start));
  const past = all.filter((m) => m.state === "completed" || m.state === "cancelled");
  const list = tab === "past" ? past : current;

  return (
    <div>
      <AdminHeader
        title={t("Maintenance")}
        description={t("Planned closures and staff shutdowns. Scheduling one cancels the bookings inside it — without strikes — and tells every student affected.")}
        actions={
          <Button icon={<CalendarPlus className="size-4" />} onClick={() => setOpen(true)}>
            {t("Schedule maintenance")}
          </Button>
        }
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(v) => patch({ tab: v === "past" ? "past" : null })}
        items={[
          { value: "current", label: t("Now & upcoming"), count: current.length || undefined },
          { value: "past", label: t("History") },
        ]}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-72 rounded-[20px]" />
      ) : list.length === 0 ? (
        <EmptyState icon={Wrench} title={tab === "past" ? t("No past maintenance") : t("Nothing scheduled")} body={tab === "past" ? undefined : t("Every facility is open as normal.")} className="rounded-[20px] border border-line bg-surface" />
      ) : (
        <TableShell>
          <thead className="border-b border-line bg-surface-2/60">
            <tr>
              <th className={th}>{t("Facility")}</th>
              <th className={th}>{t("Window")}</th>
              <th className={th}>{t("Reason")}</th>
              <th className={th}>{t("Status")}</th>
              <th className={cn(th, "text-end")}>{t("Bookings cancelled")}</th>
              <th className={th}>
                <span className="sr-only">{t("Actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((m) => (
              <tr key={m.id}>
                <td className={td}>
                  <span className="block font-semibold text-ink">{m.facility.name}</span>
                  <span className="block text-xs text-muted">
                    {KIND[m.kind]()}{" "}{t("· by")}{" "}{m.createdByName}
                  </span>
                </td>
                <td className={cn(td, "whitespace-nowrap tabular text-ink-2")}>{windowLabel(m.start, m.end)}</td>
                <td className={cn(td, "max-w-72 text-ink-2")}>{m.reason}</td>
                <td className={td}>
                  <Badge size="xs" tone={STATE[m.state].tone} dot={m.state === "active"}>
                    {STATE[m.state].label}
                  </Badge>
                </td>
                <td className={cn(td, "text-end tabular")}>{m.affectedBookingIds.length}</td>
                <td className={cn(td, "text-end")}>
                  {(m.state === "scheduled" || m.state === "active") && (
                    <Button size="xs" variant="ghost" loading={cancel.isPending && cancel.variables?.id === m.id} onClick={() => cancel.mutate(m)}>
                      {m.state === "active" ? t("Reopen now") : t("Cancel")}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <ScheduleDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
