import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Check, Download, Hourglass, Users, X } from "lucide-react";
import { api, type BookingQuery, type BookingView } from "@/api";
import type { BookingStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useDebounced, useNow } from "@/lib/hooks";
import { errorMessage, useAdminBookings, useAdminFacilities } from "@/lib/queries";
import { addDays, fmtDateTime, fmtDayShort, fmtRange, startOfDay } from "@/lib/time";
import { BOOKING_STATUS, StatusBadge } from "@/components/booking/status";
import { Button } from "@/components/ui/Button";
import { Checkbox, SearchInput, Select } from "@/components/ui/Form";
import { Avatar, EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { Drawer } from "@/components/ui/Overlay";
import { toast } from "@/components/ui/Toast";
import { AdminHeader } from "@/layouts/AdminLayout";
import { Pagination, ReasonDialog, TableShell, downloadCsv, td, th, useUrlFilters } from "./shared";
import { N, t as tr, tStored } from "@/i18n";

type Range = "upcoming" | "today" | "past7" | "all";
const RANGES: { value: Range; label: string }[] = [
  { value: "upcoming", get label() {
    return tr("Upcoming");
  } },
  { value: "today", get label() {
    return tr("Today");
  } },
  { value: "past7", get label() {
    return tr("Last 7 days");
  } },
  { value: "all", get label() {
    return tr("All time");
  } },
];
const STATUSES: BookingStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW", "CANCELLED", "EXPIRED"];
const CANCEL_REASONS = () => [tr("Facility needed for a university event"), tr("Duplicate booking"), tr("Requested by the student"), tr("Safety or maintenance issue")];
const DECLINE_REASONS = () => [tr("Facility reserved for an official event"), tr("Not enough information in the request"), tr("Outside what this space is for")];
const WAIVE_REASONS = () => [tr("Medical reason"), tr("Official university event"), tr("Facility issue on arrival"), tr("Checked in but not recorded")];

type Action = { kind: "cancel" | "decline" | "waive"; b: BookingView } | null;

function hasStrike(b: BookingView) {
  return (b.status === "NO_SHOW" && !!b.noShow && !b.noShow.waived) || (b.status === "CANCELLED" && !!b.cancellation?.penalty);
}

function DetailDrawer({ b, onClose, onAction, onApprove, approving }: { b: BookingView | null; onClose: () => void; onAction: (a: Action) => void; onApprove: (b: BookingView) => void; approving: boolean }) {
  const now = useNow(60000);
  const upcoming = b && (b.status === "PENDING" || b.status === "CONFIRMED") && new Date(b.start) > now;
  return (
    <Drawer
      open={!!b}
      onClose={onClose}
      title={b?.facility.name}
      description={b ? `${b.id} · ${fmtDayShort(b.start)}, ${fmtRange(b.start, b.end)}` : undefined}
      footer={
        b && (
          <>
            {hasStrike(b) && (
              <Button variant="ghost" onClick={() => onAction({ kind: "waive", b })}>
                {tr("Waive strike")}
              </Button>
            )}
            {upcoming && (
              <Button variant="danger-soft" onClick={() => onAction({ kind: "cancel", b })}>
                {tr("Cancel booking")}
              </Button>
            )}
            {b.status === "PENDING" && (
              <>
                <Button variant="secondary" onClick={() => onAction({ kind: "decline", b })}>
                  {tr("Decline")}
                </Button>
                <Button icon={<Check className="size-4" />} loading={approving} onClick={() => onApprove(b)}>
                  {tr("Approve")}
                </Button>
              </>
            )}
          </>
        )
      }
    >
      {b && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={b.status} />
            <span className="text-sm text-muted">{BOOKING_STATUS[b.status].description}</span>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-semibold text-muted">{tr("When")}</dt>
              <dd className="font-semibold text-ink">{fmtDayShort(b.start)}</dd>
              <dd className="text-ink-2 tabular">{fmtRange(b.start, b.end)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">{tr("Where")}</dt>
              <dd className="font-semibold text-ink">{b.unitName ?? b.facility.location.building}</dd>
              <dd className="text-ink-2">{b.category.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">{tr("Booked")}</dt>
              <dd className="text-ink-2">{fmtDateTime(b.createdAt)}</dd>
              <dd className="text-xs text-muted">{b.source === "waitlist" ? tr("From the waitlist") : b.source === "admin" ? tr("By the facilities office") : tr("By the student")}</dd>
            </div>
            {b.checkIn && (
              <div>
                <dt className="text-xs font-semibold text-muted">{tr("Checked in")}</dt>
                <dd className="text-ink-2">
                  {fmtDateTime(b.checkIn.at)} · {b.checkIn.method === "qr" ? "QR" : "manual"}
                  {b.checkIn.headcount ? ` · ${N.person(b.checkIn.headcount)}` : ""}
                </dd>
              </div>
            )}
          </dl>
          {b.purpose && (
            <p className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">
              <span className="font-semibold text-ink">{tr("Purpose:")}{" "}</span>
              {b.purpose}
            </p>
          )}
          {b.cancellation && (
            <p className={cn("rounded-xl p-3 text-sm", b.cancellation.penalty ? "bg-danger-soft" : "bg-surface-2")}>
              <span className="font-semibold text-ink">{b.cancellation.late ? tr("Cancelled late") : tr("Cancelled")}</span> {fmtDateTime(b.cancellation.at)}{" "}{b.cancellation.byRole === "student" ? tr("by the student") : tr("by the facilities office")} — {b.cancellation.reason}
              {b.cancellation.penalty && ` · ${tr("counts as a strike")}`}
            </p>
          )}
          {b.noShow && (
            <p className="rounded-xl bg-danger-soft p-3 text-sm">
              <span className="font-semibold text-ink">{tr("No-show")}</span> {b.noShow.auto ? "marked automatically after the grace period" : "marked by staff"}
              {b.noShow.waived && ` · ${tr("strike waived: {reason}", { reason: b.noShow.waived.reason })}`}
            </p>
          )}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
              <Users className="size-4 text-muted" />{" "}{tr("People (")}{b.people.length + 1})
            </h3>
            <ul className="space-y-1.5">
              {[b.booker, ...b.people].map((p, i) => (
                <li key={p.id}>
                  <Link to={`/admin/students?open=${p.id}`} className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-surface-2">
                    <Avatar name={p.name} hue={p.avatarHue} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{p.name}</span>
                      <span className="block text-xs text-muted">{[i === 0 ? tr("Booker") : null, p.universityId, tStored(p.faculty)].filter(Boolean).join(" · ")}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Drawer>
  );
}

export default function BookingsPage() {
  const { get, patch } = useUrlFilters();
  const now = useNow(60000);
  const facilities = useAdminFacilities();
  const range = (RANGES.some((r) => r.value === get("range")) ? get("range") : "upcoming") as Range;
  const statuses = get("status").split(",").filter((s): s is BookingStatus => STATUSES.includes(s as BookingStatus));
  const page = Number(get("page")) || 1;
  const [text, setText] = useState(get("q"));
  const q = useDebounced(text, 250);
  useEffect(() => {
    if (q.trim() !== get("q")) patch({ q: q.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Pin "now" to the minute so the query key doesn't change every render.
  const minute = Math.floor(now.getTime() / 60000);
  const query = useMemo<BookingQuery>(() => {
    const t = new Date(minute * 60000);
    const today = startOfDay(t);
    const r: Record<Range, Pick<BookingQuery, "from" | "to" | "sort">> = {
      upcoming: { from: t.toISOString(), sort: "start_asc" },
      today: { from: today.toISOString(), to: addDays(today, 1).toISOString(), sort: "start_asc" },
      past7: { from: addDays(today, -7).toISOString(), to: t.toISOString(), sort: "start_desc" },
      all: { sort: "start_desc" },
    };
    return { ...r[range], q: get("q") || undefined, facilityId: get("facility") || undefined, statuses: statuses.length ? statuses : undefined, page, pageSize: 20 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minute, range, get("q"), get("facility"), get("status"), page]);
  const list = useAdminBookings(query);

  const [openId, setOpenId] = useState<string | null>(null);
  const open = list.data?.rows.find((b) => b.id === openId) ?? null;
  const [action, setAction] = useState<Action>(null);
  const [notifyStudents, setNotifyStudents] = useState(true);

  const approve = useMutation({
    mutationFn: (b: BookingView) => api.admin.decide(b.id, "approved"),
    onSuccess: (b) => toast.success(tr("Request approved"), tr("{name} has been notified.", { name: b.booker.name })),
    onError: (e) => toast.error(tr("Couldn’t approve"), errorMessage(e)),
  });
  const act = useMutation({
    mutationFn: async ({ a, reason }: { a: NonNullable<Action>; reason: string }) => {
      if (a.kind === "cancel") return api.admin.cancelBooking(a.b.id, reason, notifyStudents);
      if (a.kind === "decline") return api.admin.decide(a.b.id, "rejected", reason || undefined);
      return api.admin.waiveStrike(a.b.id, reason);
    },
    onSuccess: (_r, { a }) => {
      toast.success(a.kind === "cancel" ? tr("Booking cancelled") : a.kind === "decline" ? tr("Request declined") : tr("Strike waived"), a.kind === "cancel" && !notifyStudents ? tr("Students were not notified.") : tr("{name} has been notified.", { name: a.b.booker.name }));
      setAction(null);
    },
  });

  const toggleStatus = (s: BookingStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    patch({ status: next.join(",") });
  };

  const exportAll = async () => {
    const all = await api.admin.bookings({ ...query, page: 1, pageSize: 100000 });
    downloadCsv(
      `bookings-${range}.csv`,
      ["Booking", "Facility", "Unit", "Start", "End", "Status", "Booker", "University ID", "People", "Created"],
      all.rows.map((b) => [b.id, b.facility.name, b.unitName, b.start, b.end, b.status, b.booker.name, b.booker.universityId, b.people.length + 1, b.createdAt]),
    );
  };

  const pendingOnly = statuses.length === 1 && statuses[0] === "PENDING";

  return (
    <div>
      <AdminHeader
        title={tr("Bookings")}
        description={tr("Every booking on campus. Approve requests, cancel on a student’s behalf, or waive a strike.")}
        actions={
          <Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={exportAll} disabled={!list.data?.total}>
            {tr("Export CSV")}
          </Button>
        }
      />

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <SearchInput value={text} onChange={setText} placeholder={tr("Booking ID, student name or ID")} label={tr("Search bookings")} className="min-w-60 flex-1" />
          <div className="w-56">
            <Select aria-label={tr("Facility")} value={get("facility")} onChange={(e) => patch({ facility: e.target.value })}>
              <option value="">{tr("All facilities")}</option>
              {(facilities.data ?? []).map((f) => (
                <option key={f.facility.id} value={f.facility.id}>
                  {f.facility.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="inline-flex h-11 rounded-xl bg-surface-2 p-1" role="group" aria-label={tr("Date range")}>
            {RANGES.map((r) => (
              <button key={r.value} type="button" aria-pressed={range === r.value} onClick={() => patch({ range: r.value === "upcoming" ? null : r.value })} className={cn("rounded-lg px-3 text-xs font-semibold", range === r.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tr("Status")}>
          {STATUSES.map((s) => {
            const on = statuses.includes(s);
            return (
              <button key={s} type="button" aria-pressed={on} onClick={() => toggleStatus(s)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors", on ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:border-line-strong")}>
                {BOOKING_STATUS[s].label}
              </button>
            );
          })}
          {statuses.length > 0 && (
            <button type="button" onClick={() => patch({ status: null })} className="inline-flex h-8 items-center gap-1 px-2 text-xs font-semibold text-muted hover:text-ink">
              <X className="size-3.5" />{" "}{tr("Clear")}
            </button>
          )}
        </div>
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data ? (
        <Skeleton className="h-96 rounded-[20px]" />
      ) : list.data.rows.length === 0 ? (
        <EmptyState icon={pendingOnly ? Hourglass : Check} title={pendingOnly ? tr("No requests waiting") : tr("No bookings match")} body={pendingOnly ? tr("Every approval request has been handled.") : tr("Try another date range, facility or status.")} className="rounded-[20px] border border-line bg-surface" />
      ) : (
        <>
          <TableShell>
            <thead className="border-b border-line bg-surface-2/60">
              <tr>
                <th className={th}>{tr("Booking")}</th>
                <th className={th}>{tr("Student")}</th>
                <th className={th}>{tr("Facility")}</th>
                <th className={th}>{tr("When")}</th>
                <th className={th}>{tr("Status")}</th>
                <th className={cn(th, "text-end")}>
                  <span className="sr-only">{tr("Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.rows.map((b) => (
                <tr key={b.id} onClick={() => setOpenId(b.id)} className="cursor-pointer transition-colors hover:bg-surface-2/60">
                  <td className={td}>
                    <button type="button" onClick={() => setOpenId(b.id)} className="font-mono text-xs font-semibold text-ink hover:underline">
                      {b.id}
                    </button>
                  </td>
                  <td className={td}>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={b.booker.name} hue={b.booker.avatarHue} size={28} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">{b.booker.name}</span>
                        <span className="block text-xs text-muted">
                          {b.booker.universityId}
                          {b.people.length > 0 && ` · +${b.people.length}`}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className={td}>
                    <span className="block font-medium text-ink">{b.facility.name}</span>
                    {b.unitName && <span className="block text-xs text-muted">{b.unitName}</span>}
                  </td>
                  <td className={cn(td, "whitespace-nowrap tabular")}>
                    <span className="block text-ink">{fmtDayShort(b.start)}</span>
                    <span className="block text-xs text-muted">{fmtRange(b.start, b.end)}</span>
                  </td>
                  <td className={td}>
                    <StatusBadge status={b.status} size="xs" />
                    {hasStrike(b) && <span className="ms-1.5 text-[11px] font-semibold text-danger">{tr("Strike")}</span>}
                  </td>
                  <td className={cn(td, "text-end")} onClick={(e) => e.stopPropagation()}>
                    {b.status === "PENDING" && (
                      <span className="inline-flex gap-1">
                        <Button size="xs" variant="secondary" onClick={() => setAction({ kind: "decline", b })}>
                          {tr("Decline")}
                        </Button>
                        <Button size="xs" loading={approve.isPending && approve.variables?.id === b.id} onClick={() => approve.mutate(b)}>
                          {tr("Approve")}
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => patch({ page: p })} />
        </>
      )}

      <DetailDrawer b={open} onClose={() => setOpenId(null)} onAction={setAction} onApprove={(b) => approve.mutate(b)} approving={approve.isPending} />

      <ReasonDialog
        open={action?.kind === "cancel"}
        onClose={() => setAction(null)}
        title={tr("Cancel this booking?")}
        description={action ? `${action.b.facility.name} · ${fmtDayShort(action.b.start)}, ${fmtRange(action.b.start, action.b.end)} · ${action.b.booker.name}` : undefined}
        presets={CANCEL_REASONS()}
        confirmLabel={tr("Cancel booking")}
        variant="danger"
        loading={act.isPending}
        error={act.isError ? errorMessage(act.error) : undefined}
        onConfirm={(reason) => action && act.mutate({ a: action, reason })}
      >
        <p className="text-sm text-ink-2">{tr("No strike is recorded.")}{" "}{action?.b.status === "CONFIRMED" ? tr("The spot is offered to the next student on the waitlist.") : ""}</p>
        <Checkbox checked={notifyStudents} onChange={setNotifyStudents} label={tr("Notify {v}", { v: action && action.b.people.length ? `all ${action.b.people.length + 1} people` : "the student" })} />
      </ReasonDialog>
      <ReasonDialog
        open={action?.kind === "decline"}
        onClose={() => setAction(null)}
        title={tr("Decline this request?")}
        description={action ? `${action.b.facility.name} · ${fmtDayShort(action.b.start)}, ${fmtRange(action.b.start, action.b.end)} · ${action.b.booker.name}` : undefined}
        presets={DECLINE_REASONS()}
        confirmLabel={tr("Decline request")}
        variant="danger"
        optional
        loading={act.isPending}
        error={act.isError ? errorMessage(act.error) : undefined}
        onConfirm={(reason) => action && act.mutate({ a: action, reason })}
      />
      <ReasonDialog
        open={action?.kind === "waive"}
        onClose={() => setAction(null)}
        title={tr("Waive this strike?")}
        description={action ? `${action.b.booker.name} · ${action.b.facility.name}, ${fmtDayShort(action.b.start)}` : undefined}
        presets={WAIVE_REASONS()}
        confirmLabel={tr("Waive strike")}
        loading={act.isPending}
        error={act.isError ? errorMessage(act.error) : undefined}
        onConfirm={(reason) => action && act.mutate({ a: action, reason })}
      />
    </div>
  );
}
