import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Lock, Pencil, UserPlus, Users } from "lucide-react";
import { api, type TeamMember } from "@/api";
import type { Permission, Role, RoleKey, SystemSettings, User } from "@/domain/types";
import { cn } from "@/lib/cn";
import { errorMessage, useAdminFacilities, useSettings, useTeam } from "@/lib/queries";
import { fmtAgo } from "@/lib/time";
import { useCan, useSession } from "@/state/session";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Stepper, Switch } from "@/components/ui/Form";
import { Avatar, Badge, Card, EmptyState, ErrorState, Skeleton, Tabs } from "@/components/ui/Primitives";
import { Dialog } from "@/components/ui/Overlay";
import { toast } from "@/components/ui/Toast";
import { AdminHeader } from "@/layouts/AdminLayout";
import { TableShell, td, th, useUrlFilters } from "./shared";
import { t as tr, word } from "@/i18n";
import { ResetPasswordButton, TempPasswordDialog } from "./ResetPassword";
import { facilityName } from "@/domain/localize";

const PERMISSION_GROUPS: { title: string; perms: { key: Permission; label: string }[] }[] = [
  {
    get title() {
    return tr("Booking");
  },
    perms: [
      { key: "facility.view", get label() {
    return tr("Browse facilities");
  } },
      { key: "booking.create", get label() {
    return tr("Make bookings");
  } },
      { key: "booking.cancel.own", get label() {
    return tr("Cancel their own bookings");
  } },
      { key: "waitlist.join", get label() {
    return tr("Join waitlists");
  } },
    ],
  },
  {
    get title() {
    return tr("Operations");
  },
    perms: [
      { key: "schedule.view", get label() {
    return tr("See daily schedules");
  } },
      { key: "checkin.perform", get label() {
    return tr("Check students in");
  } },
      { key: "noshow.mark", get label() {
    return tr("Mark no-shows and waive them");
  } },
      { key: "facility.report_issue", get label() {
    return tr("Report and update issues");
  } },
      { key: "facility.close_temporarily", get label() {
    return tr("Close a facility temporarily");
  } },
    ],
  },
  {
    get title() {
    return tr("Administration");
  },
    perms: [
      { key: "analytics.view", get label() {
    return tr("Open the admin console & analytics");
  } },
      { key: "facility.manage", get label() {
    return tr("Create and edit facilities");
  } },
      { key: "category.manage", get label() {
    return tr("Manage facility types");
  } },
      { key: "booking.manage", get label() {
    return tr("Manage any booking");
  } },
      { key: "student.manage", get label() {
    return tr("Manage students and restrictions");
  } },
      { key: "policy.manage", get label() {
    return tr("Edit type and facility rules");
  } },
      { key: "maintenance.manage", get label() {
    return tr("Schedule maintenance");
  } },
      { key: "waitlist.manage", get label() {
    return tr("Manage waitlists");
  } },
      { key: "fairness.review", get label() {
    return tr("Review fair-use flags");
  } },
      { key: "audit.view", get label() {
    return tr("Read the audit log");
  } },
      { key: "staff.manage", get label() {
    return tr("Manage facility staff");
  } },
      { key: "settings.manage", get label() {
    return tr("Change general settings");
  } },
    ],
  },
  {
    get title() {
    return tr("Super admin");
  },
    perms: [
      { key: "policy.global.manage", get label() {
    return tr("Edit campus-wide rules");
  } },
      { key: "admin.manage", get label() {
    return tr("Manage administrators");
  } },
      { key: "role.manage", get label() {
    return tr("Change role permissions");
  } },
      { key: "security.manage", get label() {
    return tr("Change security settings");
  } },
    ],
  },
];

const ROLE_TONE: Record<RoleKey, "neutral" | "info" | "brand" | "violet"> = { student: "neutral", staff: "info", admin: "brand", super_admin: "violet" };

/* ───────────── General & security ───────────── */

function SettingsForm({ settings, security }: { settings: SystemSettings; security: boolean }) {
  const canEdit = useCan(security ? "security.manage" : "settings.manage");
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const keys: (keyof SystemSettings)[] = security ? ["qrRotationSeconds", "sessionTimeoutMinutes", "bookingRateLimitPerMinute", "allowedEmailDomains", "maxDevicesPerStudent"] : ["universityName", "productName", "supportEmail", "weekStartsOn", "reminderMinutesBefore"];
  const changed = keys.filter((k) => JSON.stringify(s[k]) !== JSON.stringify(settings[k]));
  const [domains, setDomains] = useState(settings.allowedEmailDomains.join(", "));
  useEffect(() => setDomains(settings.allowedEmailDomains.join(", ")), [settings.allowedEmailDomains]);
  const save = useMutation({
    mutationFn: () => api.admin.updateSettings(Object.fromEntries(changed.map((k) => [k, s[k]])) as Partial<SystemSettings>, `Changed ${changed.join(", ")}`),
    onSuccess: () => toast.success(tr("Settings saved")),
    onError: (e) => toast.error(tr("Couldn’t save"), errorMessage(e)),
  });
  const set = <K extends keyof SystemSettings>(k: K, v: SystemSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const row = (label: string, help: string, control: React.ReactNode) => (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="sm:max-w-md">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="text-xs leading-relaxed text-muted">{help}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </li>
  );
  return (
    <Card className="p-5">
      {!canEdit && (
        <p className="mb-2 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs font-semibold text-muted">
          <Lock className="size-3.5" /> {security ? tr("Only super admins can change security settings.") : tr("You can view these settings but not change them.")}
        </p>
      )}
      <fieldset disabled={!canEdit}>
        <ul className="divide-y divide-line">
          {security ? (
            <>
              {row(tr("QR code refresh"), tr("How often ticket codes change. Shorter makes screenshots useless sooner."), <Stepper label={tr("QR code refresh")} value={s.qrRotationSeconds} min={10} max={120} step={5} unit={tr("sec")} onChange={(v) => set("qrRotationSeconds", v)} />)}
              {row(tr("Sign-out after inactivity"), tr("Staff and administrators are signed out after this long without activity. Students stay signed in on their own phone."), <Stepper label={tr("Session timeout")} value={s.sessionTimeoutMinutes} min={5} max={480} step={5} unit={tr("min")} onChange={(v) => set("sessionTimeoutMinutes", v)} />)}
              {row(tr("Booking rate limit"), tr("Maximum booking attempts per student per minute — stops scripts grabbing slots."), <Stepper label={tr("Booking rate limit")} value={s.bookingRateLimitPerMinute} min={1} max={60} unit={tr("/ min")} onChange={(v) => set("bookingRateLimitPerMinute", v)} />)}
              {row(
                tr("University email domains"),
                tr("Only addresses at these domains can register. Separate several with commas."),
                <div className="w-72">
                  <Input
                    aria-label={tr("University email domains")}
                    value={domains}
                    placeholder={tr("badya.edu.eg")}
                    onChange={(e) => {
                      setDomains(e.target.value);
                      set("allowedEmailDomains", e.target.value.split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean));
                    }}
                  />
                </div>,
              )}
              {row(tr("Devices per student"), tr("How many devices one student account can use. Anything beyond this — or a second account on the same device — waits for an administrator’s approval."), <Stepper label={tr("Devices per student")} value={s.maxDevicesPerStudent} min={1} max={5} unit={word(s.maxDevicesPerStudent, ["device", "devices"], ["جهاز", "أجهزة", "جهازًا"])} onChange={(v) => set("maxDevicesPerStudent", v)} />)}
            </>
          ) : (
            <>
              {row(tr("University name"), tr("Shown on the sign-in page."), <div className="w-72"><Input aria-label={tr("University name")} value={s.universityName} onChange={(e) => set("universityName", e.target.value)} /></div>)}
              {row(tr("Product name"), tr("What students call the booking service."), <div className="w-72"><Input aria-label={tr("Product name")} value={s.productName} onChange={(e) => set("productName", e.target.value)} /></div>)}
              {row(tr("Support email"), tr("Where students are told to write with questions."), <div className="w-72"><Input aria-label={tr("Support email")} type="email" value={s.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} /></div>)}
              {row(tr("Week starts on"), tr("Weekly booking limits reset on this day."), <div className="w-48"><Select aria-label={tr("Week starts on")} value={s.weekStartsOn} onChange={(e) => set("weekStartsOn", Number(e.target.value) as SystemSettings["weekStartsOn"])}><option value={6}>{tr("Saturday")}</option><option value={0}>{tr("Sunday")}</option><option value={1}>{tr("Monday")}</option></Select></div>)}
              {row(tr("Default reminder"), tr("When new students are reminded before a session. Students can change their own."), <Stepper label={tr("Default reminder")} value={s.reminderMinutesBefore} min={5} max={1440} step={5} unit={tr("min")} onChange={(v) => set("reminderMinutesBefore", v)} />)}
              {row(tr("Time zone"), tr("All sessions and reminders use campus time."), <span className="text-sm font-semibold text-ink-2">{s.timezone}</span>)}
            </>
          )}
        </ul>
      </fieldset>
      {canEdit && (
        <div className="mt-2 flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" disabled={!changed.length} onClick={() => setS(settings)}>
            {tr("Discard")}
          </Button>
          <Button disabled={!changed.length} loading={save.isPending} onClick={() => save.mutate()}>
            {tr("Save")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ───────────── Roles ───────────── */

function RolesMatrix({ roles }: { roles: Role[] }) {
  const canEdit = useCan("role.manage");
  const [draft, setDraft] = useState<Record<string, Permission[]>>({});
  useEffect(() => setDraft(Object.fromEntries(roles.map((r) => [r.key, r.permissions]))), [roles]);
  const changedRoles = roles.filter((r) => r.key !== "super_admin" && JSON.stringify([...(draft[r.key] ?? [])].sort()) !== JSON.stringify([...r.permissions].sort()));
  const save = useMutation({
    mutationFn: async () => {
      for (const r of changedRoles) await api.admin.updateRole(r.key, draft[r.key]);
    },
    onSuccess: () => toast.success(tr("Permissions saved"), tr("They apply the next time each person loads the app.")),
    onError: (e) => toast.error(tr("Couldn’t save"), errorMessage(e)),
  });
  const toggle = (role: RoleKey, p: Permission) => setDraft((d) => ({ ...d, [role]: d[role]?.includes(p) ? d[role].filter((x) => x !== p) : [...(d[role] ?? []), p] }));
  const warnings = [
    !draft.admin?.includes("analytics.view") && tr("Administrators without “Open the admin console” can’t reach any admin page."),
    !draft.staff?.includes("schedule.view") && tr("Staff without “See daily schedules” can’t open the operations app."),
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      {warnings.map((w) => (
        <p key={w} className="flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm font-semibold text-warning">
          <AlertTriangle className="size-4 shrink-0" /> {w}
        </p>
      ))}
      <TableShell>
        <thead className="border-b border-line bg-surface-2/60">
          <tr>
            <th className={th}>{tr("Permission")}</th>
            {roles.map((r) => (
              <th key={r.key} className={cn(th, "text-center")} title={r.description}>
                {r.name}
                {r.key === "super_admin" && <Lock className="ms-1 inline size-3" aria-label={tr("fixed")} />}
              </th>
            ))}
          </tr>
        </thead>
        {PERMISSION_GROUPS.map((g) => (
          <tbody key={g.title} className="divide-y divide-line border-b border-line last:border-b-0">
            <tr>
              <th colSpan={roles.length + 1} scope="colgroup" className="bg-surface-2/40 px-3 py-1.5 text-start text-[11px] font-bold uppercase tracking-wider text-faint">
                {g.title}
              </th>
            </tr>
            {g.perms.map((p) => (
              <tr key={p.key}>
                <th scope="row" className={cn(td, "text-start font-normal")}>
                  <span className="block text-ink">{p.label}</span>
                  <span className="block font-mono text-[11px] text-faint">{p.key}</span>
                </th>
                {roles.map((r) => {
                  const on = r.key === "super_admin" ? r.permissions.includes(p.key) : !!draft[r.key]?.includes(p.key);
                  return (
                    <td key={r.key} className={cn(td, "text-center")}>
                      <input type="checkbox" aria-label={`${r.name}: ${p.label}`} checked={on} disabled={!canEdit || r.key === "super_admin"} onChange={() => toggle(r.key, p.key)} className="size-4 cursor-pointer accent-[var(--brand)] disabled:cursor-not-allowed" />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </TableShell>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">{tr("Super admin permissions are fixed so nobody can lock the university out.")}</p>
        {canEdit ? (
          <span className="flex gap-2">
            <Button variant="ghost" disabled={!changedRoles.length} onClick={() => setDraft(Object.fromEntries(roles.map((r) => [r.key, r.permissions])))}>
              {tr("Discard")}
            </Button>
            <Button disabled={!changedRoles.length} loading={save.isPending} onClick={() => save.mutate()}>
              {tr("Save permissions")}
            </Button>
          </span>
        ) : (
          <Badge icon={<Lock className="size-3" />}>{tr("Super admins only")}</Badge>
        )}
      </div>
    </div>
  );
}

/* ───────────── Team ───────────── */

type MemberForm = { id?: string; name: string; email: string; title: string; role: RoleKey; assignedFacilityIds: string[]; status: User["status"] };

function MemberDialog({ member, open, onClose, onAdded }: { member: TeamMember | null; open: boolean; onClose: () => void; onAdded: (name: string, password: string) => void }) {
  const me = useSession((s) => s.user)!;
  const canAdmins = useCan("admin.manage");
  const facilities = useAdminFacilities();
  const empty: MemberForm = { name: "", email: "", title: "", role: "staff", assignedFacilityIds: [], status: "active" };
  const [m, setM] = useState<MemberForm>(empty);
  useEffect(() => {
    if (open) setM(member ? { id: member.id, name: member.name, email: member.email, title: member.title ?? "", role: member.role, assignedFacilityIds: member.assignedFacilityIds ?? [], status: member.status } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member]);
  const save = useMutation({
    mutationFn: () => api.admin.saveMember(m),
    onSuccess: (u) => {
      toast.success(member ? tr("Changes saved") : tr("{name} added", { name: u.name }));
      onClose();
      if (!member && u.tempPassword) onAdded(u.name, u.tempPassword);
    },
  });
  const self = member?.id === me.id;
  const lockedRole = !!member && (member.role === "admin" || member.role === "super_admin") && !canAdmins;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={member ? tr("Edit {name}", { name: member.name }) : tr("Add a team member")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button loading={save.isPending} disabled={m.name.trim().length < 3 || !m.email.trim() || lockedRole} onClick={() => save.mutate()}>
            {member ? tr("Save") : tr("Add member")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.isError && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{errorMessage(save.error)}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={tr("Full name")} htmlFor="tm-name">
            <Input id="tm-name" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} />
          </Field>
          <Field label={tr("Job title")} htmlFor="tm-title" optional>
            <Input id="tm-title" value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} placeholder={tr("Sports Courts supervisor")} />
          </Field>
        </div>
        <Field label={tr("University email")} htmlFor="tm-email" hint={tr("Must end in @badya.edu.eg.")}>
          <Input id="tm-email" type="email" value={m.email} onChange={(e) => setM({ ...m, email: e.target.value })} placeholder={tr("name@badya.edu.eg")} />
        </Field>
        <Field label={tr("Role")} htmlFor="tm-role" hint={self ? tr("You can’t change your own role.") : !canAdmins ? tr("Only super admins can create administrators.") : undefined}>
          <Select id="tm-role" value={m.role} disabled={self || lockedRole} onChange={(e) => setM({ ...m, role: e.target.value as RoleKey })}>
            <option value="staff">{tr("Facility staff")}</option>
            <option value="admin" disabled={!canAdmins}>
              {tr("Administrator")}
            </option>
            <option value="super_admin" disabled={!canAdmins}>
              {tr("Super admin")}
            </option>
          </Select>
        </Field>
        {m.role === "staff" && (
          <fieldset>
            <legend className="mb-2 text-[13px] font-semibold text-ink">{tr("Facilities they run")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {(facilities.data ?? []).map((f) => {
                const on = m.assignedFacilityIds.includes(f.facility.id);
                // Archived facilities have no day to run — shown only so an old assignment can be removed.
                if (f.facility.archived && !on) return null;
                return (
                  <button key={f.facility.id} type="button" aria-pressed={on} onClick={() => setM({ ...m, assignedFacilityIds: on ? m.assignedFacilityIds.filter((x) => x !== f.facility.id) : [...m.assignedFacilityIds, f.facility.id] })} className={cn("h-8 rounded-full border px-3 text-xs font-semibold", on ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-ink-2")}>
                    {facilityName(f.facility)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        {member && !self && <Switch checked={m.status === "active"} onChange={(v) => setM({ ...m, status: v ? "active" : "suspended" })} label={tr("Account active")} description={tr("Suspended members can’t sign in. Their history is kept.")} />}
      </div>
    </Dialog>
  );
}

function Team() {
  const q = useTeam();
  const canManage = useCan("staff.manage");
  const canAdmins = useCan("admin.manage");
  const [editing, setEditing] = useState<TeamMember | "new" | null>(null);
  const [added, setAdded] = useState<{ name: string; password: string } | null>(null);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-72 rounded-[20px]" />;
  const order: Record<RoleKey, number> = { super_admin: 0, admin: 1, staff: 2, student: 3 };
  const rows = [...q.data].sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canManage && (
          <Button icon={<UserPlus className="size-4" />} onClick={() => setEditing("new")}>
            {tr("Add member")}
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Users} title={tr("No team members yet")} className="rounded-[20px] border border-line bg-surface" />
      ) : (
        <TableShell>
          <thead className="border-b border-line bg-surface-2/60">
            <tr>
              <th className={th}>{tr("Name")}</th>
              <th className={th}>{tr("Role")}</th>
              <th className={th}>{tr("Facilities")}</th>
              <th className={th}>{tr("Last active")}</th>
              <th className={th}>
                <span className="sr-only">{tr("Actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((u) => (
              <tr key={u.id} className={cn(u.status === "suspended" && "opacity-60")}>
                <td className={td}>
                  <span className="flex items-center gap-2.5">
                    <Avatar name={u.name} hue={u.avatarHue} size={30} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">
                        {u.name}
                        {u.status === "suspended" && <span className="ms-1.5 text-xs font-medium text-danger">{tr("Suspended")}</span>}
                      </span>
                      <span className="block truncate text-xs text-muted">{[u.title, u.email].filter(Boolean).join(" · ")}</span>
                    </span>
                  </span>
                </td>
                <td className={td}>
                  <Badge size="xs" tone={ROLE_TONE[u.role]}>
                    {u.role === "super_admin" ? tr("Super admin") : u.role === "admin" ? tr("Administrator") : tr("Facility staff")}
                  </Badge>
                </td>
                <td className={cn(td, "max-w-72 text-xs text-ink-2")}>{u.role === "staff" ? u.facilityNames.join(", ") || <span className="text-danger">{tr("None assigned")}</span> : <span className="text-muted">{tr("All")}</span>}</td>
                <td className={cn(td, "whitespace-nowrap text-xs text-muted")}>{u.lastActiveAt ? fmtAgo(u.lastActiveAt) : tr("Never")}</td>
                <td className={cn(td, "text-end")}>
                  {canManage && (
                    <span className="inline-flex gap-1">
                      {(u.role === "staff" || canAdmins) && <ResetPasswordButton userId={u.id} name={u.name} />}
                      <Button size="xs" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(u)}>
                        {tr("Edit")}
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <MemberDialog open={!!editing} member={editing === "new" ? null : editing} onClose={() => setEditing(null)} onAdded={(name, password) => setAdded({ name, password })} />
      <TempPasswordDialog open={!!added} onClose={() => setAdded(null)} name={added?.name ?? ""} password={added?.password ?? null} />
    </div>
  );
}

export default function SettingsPage() {
  const { get, patch } = useUrlFilters();
  const q = useSettings();
  const canTeam = useCan("staff.manage");
  const tabs = [
    { value: "general", label: tr("General") },
    { value: "security", label: tr("Security") },
    { value: "roles", label: tr("Roles & permissions") },
    ...(canTeam ? [{ value: "team", label: tr("Team") }] : []),
  ];
  const tab = tabs.some((t) => t.value === get("tab")) ? get("tab") : "general";

  return (
    <div>
      <AdminHeader title={tr("Settings")} description={tr("System-wide configuration, who can do what, and the people who run campus facilities.")} />
      <Tabs className="mb-5" value={tab} onChange={(v) => patch({ tab: v === "general" ? null : v })} items={tabs} />
      {tab === "team" ? (
        <Team />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-96 rounded-[20px]" />
      ) : tab === "roles" ? (
        <RolesMatrix roles={q.data.roles} />
      ) : (
        <SettingsForm key={tab} settings={q.data.settings} security={tab === "security"} />
      )}
    </div>
  );
}
