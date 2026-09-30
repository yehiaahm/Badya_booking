import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ban, GraduationCap, IdCard, PauseCircle, Scale, Smartphone, UserCheck, UserX, Undo2 } from "lucide-react";
import { api, type StudentDetail } from "@/api";
import type { CorrectableField, UserStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useDebounced, useNow } from "@/lib/hooks";
import { errorMessage, useAdminStudent, useAdminStudents, useAppConfig } from "@/lib/queries";
import { fmtAgo, fmtDayShort, fmtRange, format } from "@/lib/time";
import { useCan } from "@/state/session";
import { StatusBadge } from "@/components/booking/status";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, SearchInput, Select } from "@/components/ui/Form";
import { Avatar, Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { Dialog, Drawer } from "@/components/ui/Overlay";
import { toast } from "@/components/ui/Toast";
import { AdminHeader } from "@/layouts/AdminLayout";
import { LevelBadge, Pagination, ReasonDialog, TableShell, td, th, useUrlFilters } from "./shared";
import { L, N, t, tStored } from "@/i18n";
import { ResetPasswordButton } from "./ResetPassword";
import { RosterCard } from "./RosterCard";

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
  { value: "suspended", get label() {
    return t("Suspended");
  } },
  { value: "deactivated", get label() {
    return t("Closed");
  } },
];
const RESTRICT_DAYS = [3, 7, 14, 30];

type Pending = { kind: "restrict" } | { kind: "lift"; id: string } | { kind: "waive"; bookingId: string; label: string } | { kind: "reset" } | { kind: "suspend" } | { kind: "unsuspend" } | { kind: "deactivate" } | { kind: "reactivate" } | { kind: "details" } | null;

/** Suspended or closed — shown next to the student's name. */
function AccountBadge({ status }: { status: UserStatus }) {
  if (status === "active") return null;
  return (
    <Badge tone={status === "suspended" ? "danger" : "neutral"} size="xs">
      {status === "suspended" ? t("Suspended") : t("Closed")}
    </Badge>
  );
}

const SOURCE: Record<StudentDetail["provenance"][CorrectableField], { label: () => string; tone: "success" | "info" | "neutral" }> = {
  official: { label: () => t("Official list"), tone: "success" },
  office: { label: () => t("Corrected by the office"), tone: "info" },
  student: { label: () => t("Entered at registration"), tone: "neutral" },
};

/** Correct a student's faculty or year — kept when the official list is loaded again. */
function DetailsDialog({ s, open, onClose }: { s: StudentDetail; open: boolean; onClose: () => void }) {
  const appConfig = useAppConfig();
  const [faculty, setFaculty] = useState(s.user.faculty ?? "");
  const [year, setYear] = useState(s.user.year ?? 1);
  useEffect(() => {
    if (!open) return;
    setFaculty(s.user.faculty ?? "");
    setYear(s.user.year ?? 1);
  }, [open, s.user.faculty, s.user.year]);
  const save = useMutation({
    mutationFn: () => api.admin.updateStudent(s.user.id, { ...(faculty !== s.user.faculty ? { faculty } : {}), ...(year !== s.user.year ? { year } : {}) }),
    onSuccess: () => {
      toast.success(t("Details corrected"), t("The student has been notified."));
      onClose();
    },
  });
  const changed = faculty !== (s.user.faculty ?? "") || year !== s.user.year;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={t("Correct {name}’s details", { name: s.user.name })}
      description={t("Students can’t change these themselves. Your correction is kept when the official list is loaded again.")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button loading={save.isPending} disabled={!changed || !faculty} onClick={() => save.mutate()}>
            {t("Save correction")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label={t("Faculty")} htmlFor="fix-faculty" hint={s.official?.faculty ? t("Official list: {value}", { value: tStored(s.official.faculty) }) : undefined}>
          <Select id="fix-faculty" value={faculty} onChange={(e) => setFaculty(e.target.value)}>
            {!faculty && <option value="">{t("Choose…")}</option>}
            {(appConfig.data?.faculties ?? []).map((f) => (
              <option key={f} value={f}>
                {tStored(f)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("Year")} htmlFor="fix-year" hint={s.official?.year ? t("Official list: {value}", { value: s.official.year }) : undefined}>
          <Select id="fix-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {save.isError && (
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
          {errorMessage(save.error)}
        </p>
      )}
    </Dialog>
  );
}

function StudentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const now = useNow(60000);
  const q = useAdminStudent(id);
  const canManage = useCan("student.manage");
  const [pending, setPending] = useState<Pending>(null);
  const [days, setDays] = useState(7);
  const [releaseBookings, setReleaseBookings] = useState(false);
  const roster = useQuery({ queryKey: ["admin", "roster"], queryFn: () => api.admin.roster(), enabled: !!id && canManage });
  const run = useMutation({
    mutationFn: async ({ p, reason }: { p: NonNullable<Pending>; reason: string }) => {
      if (p.kind === "restrict") return api.admin.restrict(id!, days, reason);
      if (p.kind === "lift") return api.admin.liftRestriction(p.id, reason);
      if (p.kind === "reset") return api.admin.resetStudentDevices(id!, reason);
      if (p.kind === "suspend") return api.admin.suspendStudent(id!, reason, releaseBookings);
      if (p.kind === "unsuspend") return api.admin.unsuspendStudent(id!, reason || undefined);
      if (p.kind === "deactivate") return api.admin.deactivateStudent(id!, reason);
      if (p.kind === "reactivate") return api.admin.reactivateStudent(id!, reason || undefined);
      if (p.kind === "waive") return api.admin.waiveStrike(p.bookingId, reason);
    },
    onSuccess: (_r, { p }) => {
      const done: Partial<Record<NonNullable<Pending>["kind"], [string, string]>> = {
        restrict: [t("Booking paused for {days}", { days: N.day(days) }), t("The student has been notified.")],
        lift: [t("Restriction lifted"), t("The student has been notified.")],
        reset: [t("Devices reset"), t("The student has been notified.")],
        waive: [t("Strike waived"), t("The student has been notified.")],
        suspend: [t("Account suspended"), t("The student has been notified.")],
        unsuspend: [t("Suspension lifted"), t("The student has been notified.")],
        deactivate: [t("Account closed"), t("They’ve been signed out everywhere. Their history is kept.")],
        reactivate: [t("Account reopened"), t("They can sign in again with their password.")],
      };
      const [title, body] = done[p.kind] ?? [t("Saved"), ""];
      toast.success(title, body);
      setPending(null);
    },
  });
  const official = useMutation({
    mutationFn: (field: CorrectableField) => api.admin.useOfficialValue(id!, field),
    onSuccess: () => toast.success(t("Correction removed")),
    onError: (e) => toast.error(t("Couldn’t change that"), errorMessage(e)),
  });
  useEffect(() => {
    setPending(null);
    setReleaseBookings(false);
  }, [id]);

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
          s.user.status === "active" &&
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
            {s.user.status !== "active" && (
              <div role="status" className={cn("rounded-2xl p-3.5 text-sm", s.user.status === "suspended" ? "bg-danger-soft" : "bg-surface-2")}>
                <p className="flex items-center gap-2 font-semibold text-ink">
                  {s.user.status === "suspended" ? <Ban className="size-4 text-danger" /> : <UserX className="size-4 text-muted" />}
                  {s.user.status === "suspended" ? t("Account suspended") : t("Account closed")}
                </p>
                {s.user.statusNote && <p className="mt-1 text-ink-2">{s.user.statusNote.reason}</p>}
                <p className="mt-1 text-xs text-muted">
                  {[s.statusByName, s.user.statusNote && fmtAgo(s.user.statusNote.at, now)].filter(Boolean).join(" · ")}
                  {s.user.statusNote ? " — " : ""}
                  {s.user.status === "suspended" ? t("They can see and cancel their bookings, but can’t book, join waitlists or invite anyone.") : t("They can’t sign in. Their bookings and history are kept.")}
                </p>
              </div>
            )}

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
                        <Button size="xs" variant="ghost" onClick={() => setPending({ kind: "waive", bookingId: x.bookingId, label: `${x.facilityName}${L(", ", "، ")}${fmtDayShort(x.at)}` })}>
                          {t("Waive")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <IdCard className="size-4 text-muted" />{" "}{t("Student record")}
                </h3>
                {canManage && s.user.status !== "deactivated" && (
                  <Button size="xs" variant="ghost" onClick={() => setPending({ kind: "details" })}>
                    {t("Correct details")}
                  </Button>
                )}
              </div>
              <dl className="divide-y divide-line rounded-2xl border border-line text-sm">
                {(["faculty", "year"] as const).map((field) => {
                  const src = SOURCE[s.provenance[field]];
                  const fix = s.corrections.find((c) => c.field === field);
                  return (
                    <div key={field} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                      <dt className="w-16 shrink-0 text-muted">{field === "faculty" ? t("Faculty") : t("Year")}</dt>
                      <dd className="min-w-0 flex-1 font-semibold text-ink">{field === "faculty" ? tStored(s.user.faculty) || "—" : (s.user.year ?? "—")}</dd>
                      <dd className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={src.tone} size="xs">
                          {src.label()}
                        </Badge>
                        {fix && <span className="text-xs text-muted">{[fix.byName, fmtAgo(fix.at, now)].filter(Boolean).join(" · ")}</span>}
                        {fix && canManage && s.user.status !== "deactivated" && (
                          <Button size="xs" variant="ghost" loading={official.isPending && official.variables === field} onClick={() => official.mutate(field)}>
                            {s.official?.[field] !== undefined ? t("Use official value") : t("Undo correction")}
                          </Button>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {s.official ? (
                <ul className="mt-2 space-y-1 text-xs text-muted">
                  <li className={cn(s.official.status === "inactive" && "font-semibold text-danger")}>{s.official.status === "inactive" ? t("Inactive on the official student list — they can’t book or be invited.") : t("On the official student list.")}</li>
                  {s.official.email && s.official.email !== s.user.email.toLowerCase() && <li className="font-semibold text-warning">{t("The list has a different email ({email}) — check this account belongs to that student.", { email: s.official.email })}</li>}
                  {s.official.idCheck && <li>{t("The list has national-ID digits for this student.")}</li>}
                </ul>
              ) : (
                (roster.data?.count ?? 0) > 0 && <p className="mt-2 text-xs font-semibold text-danger">{t("Not on the official student list — they can’t book or be invited.")}</p>
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
                        <span className="mt-0.5 block text-xs text-muted">
                          {f.status === "open" ? t("Open") : f.status === "dismissed" ? t("Dismissed") : t("Resolved")} · {fmtDayShort(f.createdAt)}
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
                        {fmtDayShort(b.start)}{L(", ", "، ")}{fmtRange(b.start, b.end)}
                        {b.booker.id !== s.user.id ? ` · ${t("with {name}", { name: b.booker.name })}` : ""}
                      </span>
                    </span>
                    <StatusBadge status={b.status} size="xs" />
                  </li>
                ))}
                {s.bookings.length === 0 && <li className="p-3 text-sm text-muted">{t("No bookings yet.")}</li>}
              </ul>
            </section>

            {canManage && (
              <section>
                <h3 className="mb-2 text-sm font-bold text-ink">{t("Account")}</h3>
                <div className="flex flex-wrap gap-2">
                  {s.user.status === "active" && (
                    <Button size="sm" variant="danger-soft" icon={<Ban className="size-4" />} onClick={() => setPending({ kind: "suspend" })}>
                      {t("Suspend account")}
                    </Button>
                  )}
                  {s.user.status === "suspended" && (
                    <Button size="sm" variant="secondary" icon={<UserCheck className="size-4" />} onClick={() => setPending({ kind: "unsuspend" })}>
                      {t("Lift suspension")}
                    </Button>
                  )}
                  {s.user.status === "deactivated" ? (
                    <Button size="sm" variant="secondary" icon={<UserCheck className="size-4" />} onClick={() => setPending({ kind: "reactivate" })}>
                      {t("Reopen account")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" icon={<UserX className="size-4" />} onClick={() => setPending({ kind: "deactivate" })}>
                      {t("Close account")}
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">{t("Suspending makes the account read-only until you lift it. Closing signs the student out for good and frees their email and university ID — use it for graduates or an account someone else registered. Nothing is deleted either way.")}</p>
              </section>
            )}
          </div>
        )}
      </Drawer>

      {s && <DetailsDialog s={s} open={pending?.kind === "details"} onClose={() => setPending(null)} />}
      <ReasonDialog
        open={pending?.kind === "suspend"}
        onClose={() => setPending(null)}
        title={t("Suspend {name}?", { name: s?.user.name ?? t("this student") })}
        description={t("They can still sign in, see and cancel their bookings, but can’t book, join waitlists or invite anyone until you lift it. Open invitations and waitlist places end now.")}
        presets={[t("Disciplinary decision"), t("Misuse of facility"), t("Identity under review")]}
        confirmLabel={t("Suspend account")}
        variant="danger"
        loading={run.isPending}
        error={run.isError ? errorMessage(run.error) : undefined}
        onConfirm={(reason) => pending && run.mutate({ p: pending, reason })}
      >
        <Checkbox checked={releaseBookings} onChange={setReleaseBookings} label={t("Also cancel their upcoming bookings ({n})", { n: s?.activeBookings ?? 0 })} />
      </ReasonDialog>
      <ReasonDialog
        open={pending?.kind === "unsuspend"}
        onClose={() => setPending(null)}
        title={t("Lift the suspension?")}
        description={t("They can book, join waitlists and invite players again straight away.")}
        presets={[t("Appeal accepted"), t("Applied in error"), t("Identity confirmed")]}
        confirmLabel={t("Lift suspension")}
        optional
        loading={run.isPending}
        error={run.isError ? errorMessage(run.error) : undefined}
        onConfirm={(reason) => pending && run.mutate({ p: pending, reason })}
      />
      <ReasonDialog
        open={pending?.kind === "deactivate"}
        onClose={() => setPending(null)}
        title={t("Close {name}’s account?", { name: s?.user.name ?? t("this student") })}
        description={t("They’re signed out everywhere and can’t sign in. Their upcoming bookings are cancelled, they leave other people’s bookings and their waitlist places end. Bookings, strikes and the audit trail are kept, and their email and university ID become free for a new account.")}
        presets={[t("Graduated"), t("Left the university"), t("Registered by someone else"), t("Duplicate account")]}
        confirmLabel={t("Close account")}
        variant="danger"
        loading={run.isPending}
        error={run.isError ? errorMessage(run.error) : undefined}
        onConfirm={(reason) => pending && run.mutate({ p: pending, reason })}
      />
      <ReasonDialog
        open={pending?.kind === "reactivate"}
        onClose={() => setPending(null)}
        title={t("Reopen this account?")}
        description={t("They can sign in again with their password. The next device they sign in on is linked. Cancelled bookings stay cancelled.")}
        confirmLabel={t("Reopen account")}
        optional
        loading={run.isPending}
        error={run.isError ? errorMessage(run.error) : undefined}
        onConfirm={(reason) => pending && run.mutate({ p: pending, reason })}
      />

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

      <RosterCard />

      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={text} onChange={setText} placeholder={t("Name, university ID or email")} label={t("Search students")} className="min-w-60 flex-1" />
        <div className="inline-flex h-11 max-w-full overflow-x-auto rounded-xl bg-surface-2 p-1" role="group" aria-label={t("Standing")}>
          {LEVELS.map((l) => (
            <button key={l.value} type="button" aria-pressed={get("level") === l.value} onClick={() => patch({ level: l.value })} className={cn("shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-semibold", get("level") === l.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="w-60">
          <Select aria-label={t("Faculty")} value={get("faculty")} onChange={(e) => patch({ faculty: e.target.value })}>
            <option value="">{t("All faculties")}</option>
            {(appConfig.data?.faculties ?? []).map((f) => (
              <option key={f} value={f}>
                {tStored(f)}
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
                        <span className="flex items-center gap-1.5">
                          <button type="button" onClick={() => setOpen(r.user.id)} className="block truncate text-start font-semibold text-ink hover:underline">
                            {r.user.name}
                          </button>
                          <AccountBadge status={r.user.status} />
                        </span>
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
