import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { GraduationCap, PauseCircle, Scale, Smartphone, UserX, Undo2 } from "lucide-react";
import { api } from "@/api";
import { cn } from "@/lib/cn";
import { useDebounced, useNow } from "@/lib/hooks";
import { errorMessage, useAdminStudent, useAdminStudents, useAppConfig } from "@/lib/queries";
import { fmtAgo, fmtDayShort, fmtRange, format } from "@/lib/time";
import { useCan } from "@/state/session";
import { StatusBadge } from "@/components/booking/status";
import { Button } from "@/components/ui/Button";
import { SearchInput, Select } from "@/components/ui/Form";
import { Avatar, EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { Drawer } from "@/components/ui/Overlay";
import { toast } from "@/components/ui/Toast";
import { AdminHeader } from "@/layouts/AdminLayout";
import { LevelBadge, Pagination, ReasonDialog, TableShell, td, th, useUrlFilters } from "./shared";
import { L, N, t, tStored } from "@/i18n";
import { ResetPasswordButton } from "./ResetPassword";

const LEVELS = [
  { value: "", get label() {
    return t("Everyone");
  } },
  { value: "attention", get label() {
    return t("Needs attention");
  } },
  { value: "restricted", get label() {
    return t("Paused");
  } },
];
const RESTRICT_DAYS = [3, 7, 14, 30];

type Pending = { kind: "restrict" } | { kind: "lift"; id: string } | { kind: "waive"; bookingId: string; label: string } | { kind: "reset" } | null;

function StudentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const now = useNow(60000);
  const q = useAdminStudent(id);
  const canManage = useCan("student.manage");
  const [pending, setPending] = useState<Pending>(null);
  const [days, setDays] = useState(7);
  const run = useMutation({
    mutationFn: async ({ p, reason }: { p: NonNullable<Pending>; reason: string }) => {
      if (p.kind === "restrict") return api.admin.restrict(id!, days, reason);
      if (p.kind === "lift") return api.admin.liftRestriction(p.id, reason);
      if (p.kind === "reset") return api.admin.resetStudentDevices(id!, reason);
      return api.admin.waiveStrike(p.bookingId, reason);
    },
    onSuccess: (_r, { p }) => {
      toast.success(p.kind === "restrict" ? t("Booking paused for {days}", { days: N.day(days) }) : p.kind === "lift" ? t("Restriction lifted") : p.kind === "reset" ? t("Devices reset") : t("Strike waived"), t("The student has been notified."));
      setPending(null);
    },
  });
  useEffect(() => setPending(null), [id]);

  const s = q.data;
  const activeRestriction = s?.restrictions.find((r) => !r.lifted && new Date(r.end) > now);
  const activeStrikes = s?.standing.strikesDetail.filter((x) => new Date(x.expiresAt) > now) ?? [];

  return (
    <>
      <Drawer
        open={!!id}
        onClose={onClose}
        size="lg"
        title={s?.user.name ?? t("Student")}
        description={s ? [s.user.universityId, tStored(s.user.faculty), s.user.year ? t("Year {n}", { n: s.user.year }) : null, s.user.email].filter(Boolean).join(" · ") : undefined}
        footer={
          canManage &&
          s &&
          (activeRestriction ? (
            <Button variant="secondary" icon={<Undo2 className="size-4" />} onClick={() => setPending({ kind: "lift", id: activeRestriction.id })}>
              {t("Lift pause")}
            </Button>
          ) : (
            <Button variant="danger-soft" icon={<PauseCircle className="size-4" />} onClick={() => setPending({ kind: "restrict" })}>
              {t("Pause booking")}
            </Button>
          ))
        }
      >
        {q.isError ? (
          <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
        ) : !s ? (
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-40" />
            <Skeleton className="h-60" />
          </div>
        ) : (
          <div className="space-y-7">
            <div className="grid grid-cols-4 gap-3 text-center">
              {[
                { label: t("Upcoming"), v: s.activeBookings },
                { label: t("Bookings"), v: s.totalBookings },
                { label: t("No-shows"), v: s.noShows },
                { label: t("Strikes"), v: s.strikes },
              ].map((x) => (
                <div key={x.label} className="rounded-2xl bg-surface-2/70 p-3">
                  <p className="text-xl font-bold text-ink tabular">{x.v}</p>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">{x.label}</p>
                </div>
              ))}
            </div>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink">{t("Standing")}</h3>
                <LevelBadge level={s.level} size="sm" />
              </div>
              {activeRestriction && (
                <p className="mb-3 rounded-xl bg-danger-soft p-3 text-sm text-ink-2">
                  <span className="font-semibold text-ink">{t("Paused until")}{" "}{format(new Date(activeRestriction.end), "EEE d MMM, HH:mm")}</span> — {tStored(activeRestriction.reason)} ({activeRestriction.source === "auto" ? t("automatic") : t("set by an administrator")})
                </p>
              )}
              {activeStrikes.length === 0 ? (
                <p className="text-sm text-muted">{t("No active strikes.")}</p>
              ) : (
                <ul className="divide-y divide-line rounded-2xl border border-line">
                  {activeStrikes.map((x) => (
                    <li key={x.bookingId} className="flex items-center gap-3 p-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger">{x.type === "no_show" ? <UserX className="size-4" /> : <Undo2 className="size-4" />}</span>
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block font-semibold text-ink">
                          {x.type === "no_show" ? t("No-show") : t("Late cancellation")} · {x.facilityName}
                        </span>
                        <span className="block text-xs text-muted">
                          {fmtDayShort(x.at)}{" "}{t("· expires")}{" "}{fmtDayShort(x.expiresAt)}
                        </span>
                      </span>
                      {canManage && (
                        <Button size="xs" variant="ghost" onClick={() => setPending({ kind: "waive", bookingId: x.bookingId, label: `${x.facilityName}, ${fmtDayShort(x.at)}` })}>
                          {t("Waive")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <Smartphone className="size-4 text-muted" />{" "}{t("Devices")}
                </h3>
                {canManage && (
                  <span className="inline-flex gap-1">
                    <ResetPasswordButton userId={s.user.id} name={s.user.name} />
                    {s.devices.length > 0 && (
                      <Button size="xs" variant="ghost" onClick={() => setPending({ kind: "reset" })}>
                        {t("Reset devices")}
                      </Button>
                    )}
                  </span>
                )}
              </div>
              {s.devices.length === 0 ? (
                <p className="text-sm text-muted">{t("No linked device. The next device they sign in on will be linked.")}</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {s.devices.map((d, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2/70 px-3 py-2">
                      <span className="font-semibold text-ink">{d.label}</span>
                      <span className="text-xs text-muted">{t("last used")}{" "}{fmtAgo(d.lastSeenAt, now)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s.pendingDeviceRequests > 0 && (
                <Link to="/admin/devices" className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
                  {L(`${s.pendingDeviceRequests} device ${s.pendingDeviceRequests === 1 ? "request" : "requests"} waiting`, `${N.request(s.pendingDeviceRequests)} أجهزة في الانتظار`)}
                </Link>
              )}
            </section>

            {s.flags.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
                  <Scale className="size-4 text-muted" />{" "}{t("Fair-use flags")}
                </h3>
                <ul className="space-y-2">
                  {s.flags.map((f) => (
                    <li key={f.id}>
                      <Link to="/admin/fairness" className="block rounded-2xl border border-line p-3 text-sm hover:bg-surface-2">
                        <span className="font-semibold text-ink">{f.summary}</span>
                        <span className="mt-0.5 block text-xs capitalize text-muted">
                          {f.status} · {fmtDayShort(f.createdAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {s.frequentPartners.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-bold text-ink">{t("Often books with")}</h3>
                <div className="flex flex-wrap gap-2">
                  {s.frequentPartners.map(({ user: p, shared }) => (
                    <Link key={p.id} to={`/admin/students?open=${p.id}`} className="inline-flex items-center gap-2 rounded-full border border-line py-1 ps-1 pe-3 text-xs font-semibold text-ink-2 hover:bg-surface-2">
                      <Avatar name={p.name} hue={p.avatarHue} size={22} />
                      {p.name} <span className="text-faint">×{shared}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {s.restrictions.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-bold text-ink">{t("Pause history")}</h3>
                <ul className="space-y-1.5 text-sm">
                  {s.restrictions.map((r) => (
                    <li key={r.id} className="text-ink-2">
                      <span className="tabular">
                        {fmtDayShort(r.start)} – {fmtDayShort(r.end)}
                      </span>{" "}
                      · {r.reason}
                      {r.lifted && <span className="text-muted">{" "}{t("· lifted")}{" "}{fmtDayShort(r.lifted.at)}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink">{t("Recent bookings")}</h3>
                <Link to={`/admin/bookings?range=all&q=${encodeURIComponent(s.user.universityId ?? s.user.name)}`} className="text-xs font-semibold text-brand hover:underline">
                  {t("All bookings")}
                </Link>
              </div>
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {s.bookings.slice(0, 12).map((b) => (
                  <li key={b.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{b.facility.name}</span>
                      <span className="block text-xs text-muted tabular">
                        {fmtDayShort(b.start)}, {fmtRange(b.start, b.end)}
                        {b.booker.id !== s.user.id ? ` · ${t("with {name}", { name: b.booker.name })}` : ""}
                      </span>
                    </span>
                    <StatusBadge status={b.status} size="xs" />
                  </li>
                ))}
                {s.bookings.length === 0 && <li className="p-3 text-sm text-muted">{t("No bookings yet.")}</li>}
              </ul>
            </section>
          </div>
        )}
      </Drawer>

      <ReasonDialog
        open={pending?.kind === "restrict"}
        onClose={() => setPending(null)}
        title={t("Pause booking for {name}?", { name: s?.user.name ?? t("this student") })}
        description={t("They keep existing bookings but can’t make new ones until the pause ends.")}
        presets={[t("Repeated no-shows"), t("Fair-use violation"), t("Misuse of facility"), t("Disciplinary decision")]}
        confirmLabel={t("Pause for {days} days", { days })}
        variant="danger"
        loading={run.isPending}
        error={run.isError ? errorMessage(run.error) : undefined}
        onConfirm={(reason) => pending && run.mutate({ p: pending, reason })}
      >
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-ink">{t("For how long?")}</legend>
          <div className="grid grid-cols-4 gap-2">
            {RESTRICT_DAYS.map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={cn("h-10 rounded-xl border text-sm font-semibold", days === d ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-ink-2")}>
                {d}{" "}{t("days")}
              </button>
            ))}
          </div>
        </fieldset>
      </ReasonDialog>
      <ReasonDialog
        open={pending?.kind === "reset"}
        onClose={() => setPending(null)}
        title={t("Reset this student’s devices?")}
        description={t("All their devices are unlinked and they are signed out. The next device they sign in on becomes their linked device — without approval.")}
        presets={[t("Lost or stolen phone"), t("New phone"), t("Checked student ID at the office")]}
        confirmLabel={t("Reset devices")}
        variant="danger"
        loading={run.isPending}
        error={run.isError ? errorMessage(run.error) : undefined}
        onConfirm={(reason) => pending && run.mutate({ p: pending, reason })}
      />
      <ReasonDialog
        open={pending?.kind === "lift"}
        onClose={() => setPending(null)}
        title={t("Lift this pause?")}
        description={t("The student can book again straight away.")}
        presets={[t("Appeal accepted"), t("Applied in error"), t("Circumstances explained")]}
        confirmLabel={t("Lift pause")}
        optional
        loading={run.isPending}
        error={run.isError ? errorMessage(run.error) : undefined}
        onConfirm={(reason) => pending && run.mutate({ p: pending, reason })}
      />
      <ReasonDialog
        open={pending?.kind === "waive"}
        onClose={() => setPending(null)}
        title={t("Waive this strike?")}
        description={pending?.kind === "waive" ? pending.label : undefined}
        presets={[t("Medical reason"), t("Official university event"), t("Facility issue on arrival"), t("Checked in but not recorded")]}
        confirmLabel={t("Waive strike")}
        loading={run.isPending}
        error={run.isError ? errorMessage(run.error) : undefined}
        onConfirm={(reason) => pending && run.mutate({ p: pending, reason })}
      />
    </>
  );
}

export default function StudentsPage() {
  const { get, patch } = useUrlFilters();
  const appConfig = useAppConfig();
  const [text, setText] = useState(get("q"));
  const q = useDebounced(text, 250);
  useEffect(() => {
    if (q.trim() !== get("q")) patch({ q: q.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const page = Number(get("page")) || 1;
  const list = useAdminStudents({ q: get("q") || undefined, level: get("level") || undefined, faculty: get("faculty") || undefined, page });
  const openId = get("open") || null;
  const setOpen = (id: string | null) => patch({ open: id, page: get("page") || null });

  return (
    <div>
      <AdminHeader title={t("Students")} description={t("Standing, strikes and booking history. Students who need attention are listed first.")} />

      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={text} onChange={setText} placeholder={t("Name, university ID or email")} label={t("Search students")} className="min-w-60 flex-1" />
        <div className="inline-flex h-11 rounded-xl bg-surface-2 p-1" role="group" aria-label={t("Standing")}>
          {LEVELS.map((l) => (
            <button key={l.value} type="button" aria-pressed={get("level") === l.value} onClick={() => patch({ level: l.value })} className={cn("rounded-lg px-3 text-xs font-semibold", get("level") === l.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="w-60">
          <Select aria-label={t("Faculty")} value={get("faculty")} onChange={(e) => patch({ faculty: e.target.value })}>
            <option value="">{t("All faculties")}</option>
            {(appConfig.data?.faculties ?? []).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data ? (
        <Skeleton className="h-96 rounded-[20px]" />
      ) : list.data.rows.length === 0 ? (
        <EmptyState icon={GraduationCap} title={t("No students match")} body={t("Try a different name, ID or filter.")} className="rounded-[20px] border border-line bg-surface" />
      ) : (
        <>
          <TableShell>
            <thead className="border-b border-line bg-surface-2/60">
              <tr>
                <th className={th}>{t("Student")}</th>
                <th className={th}>{t("Faculty")}</th>
                <th className={th}>{t("Standing")}</th>
                <th className={cn(th, "text-end")}>{t("Upcoming")}</th>
                <th className={cn(th, "text-end")}>{t("Bookings")}</th>
                <th className={cn(th, "text-end")}>{t("No-shows")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.rows.map((r) => (
                <tr key={r.user.id} onClick={() => setOpen(r.user.id)} className="cursor-pointer transition-colors hover:bg-surface-2/60">
                  <td className={td}>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={r.user.name} hue={r.user.avatarHue} size={30} />
                      <span className="min-w-0">
                        <button type="button" onClick={() => setOpen(r.user.id)} className="block truncate text-start font-semibold text-ink hover:underline">
                          {r.user.name}
                        </button>
                        <span className="block text-xs text-muted tabular">{r.user.universityId}</span>
                      </span>
                    </span>
                  </td>
                  <td className={td}>
                    <span className="block text-ink-2">{tStored(r.user.faculty)}</span>
                    {r.user.year && <span className="block text-xs text-muted">{t("Year")}{" "}{r.user.year}</span>}
                  </td>
                  <td className={td}>
                    <LevelBadge level={r.level} />
                    {r.strikes > 0 && (
                      <span className="ms-1.5 text-xs text-muted">
                        {N.strike(r.strikes)}
                      </span>
                    )}
                  </td>
                  <td className={cn(td, "text-end tabular")}>{r.activeBookings}</td>
                  <td className={cn(td, "text-end tabular")}>{r.totalBookings}</td>
                  <td className={cn(td, "text-end tabular", r.noShows > 0 && "font-semibold text-danger")}>{r.noShows}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => patch({ page: p })} />
        </>
      )}

      <StudentDrawer id={openId} onClose={() => setOpen(null)} />
    </div>
  );
}
