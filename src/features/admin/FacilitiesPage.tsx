import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Building2, Plus, Tags, Trash2, Wrench } from "lucide-react";
import { api } from "@/api";
import type { CategoryKind, FacilityCategory, Motif } from "@/domain/types";
import { cn } from "@/lib/cn";
import { errorMessage, useAdminFacilities } from "@/lib/queries";
import { useCan } from "@/state/session";
import { KIND_LABEL, MOTIF_ICONS } from "@/components/icons";
import { FacilityArt } from "@/components/facility/FacilityArt";
import { capacityLabel, locationLabel } from "@/components/facility/FacilityCard";
import { Button } from "@/components/ui/Button";
import { Field, Input, SearchInput, Select, Switch, Textarea } from "@/components/ui/Form";
import { Badge, EmptyState, ErrorState, Skeleton, Tabs } from "@/components/ui/Primitives";
import { Dialog } from "@/components/ui/Overlay";
import { toast } from "@/components/ui/Toast";
import { AdminHeader } from "@/layouts/AdminLayout";
import { ReasonDialog, TableShell, td, th, useUrlFilters } from "./shared";
import { L, N, t } from "@/i18n";
import { facilityName, localFacility } from "@/domain/localize";

type Row = NonNullable<ReturnType<typeof useAdminFacilities>["data"]>[number];

/** Confirm a retire/delete action — plain yes/no, the consequences spelled out. */
function ConfirmDialog({ open, onClose, title, description, confirmLabel, danger, loading, error, onConfirm }: { open: boolean; onClose: () => void; title: string; description: string; confirmLabel: string; danger?: boolean; loading?: boolean; error?: string; onConfirm: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}

type TypeAction = { kind: "archive" | "delete"; category: FacilityCategory } | null;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function CategoryDialog({ category, open, onClose, nextOrder }: { category: FacilityCategory | null; open: boolean; onClose: () => void; nextOrder: number }) {
  const isNew = !category;
  const [c, setC] = useState<FacilityCategory>(() => blank(nextOrder));
  function blank(order: number): FacilityCategory {
    return { id: "", name: "", description: "", kind: "sports", motif: "generic", color: "#b8743f", policy: {}, sortOrder: order, active: true };
  }
  useEffect(() => {
    if (open) setC(category ?? blank(nextOrder));
  }, [open, category, nextOrder]);
  const save = useMutation({
    // Arabic-only names have no Latin letters to make an ID from — fall back to a unique one.
    mutationFn: () => api.admin.saveCategory({ ...c, id: c.id || `c_${slug(c.name) || Date.now().toString(36)}` }, isNew),
    onSuccess: (r) => {
      toast.success(isNew ? t("Facility type created") : t("Facility type saved"), r.name);
      onClose();
    },
  });
  const set = <K extends keyof FacilityCategory>(k: K, v: FacilityCategory[K]) => setC((x) => ({ ...x, [k]: v }));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isNew ? t("New facility type") : t("Edit {name}", { name: category?.name })}
      description={t("Types group facilities for browsing, colour and shared booking rules.")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button loading={save.isPending} disabled={c.name.trim().length < 3} onClick={() => save.mutate()}>
            {isNew ? t("Create type") : t("Save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("Name")} htmlFor="cat-name" error={save.isError ? errorMessage(save.error) : undefined}>
            <Input id="cat-name" value={c.name} onChange={(e) => set("name", e.target.value)} placeholder={t("e.g. Racket Sports")} />
          </Field>
          <Field label={t("Arabic name")} htmlFor="cat-name-ar" optional>
            <Input id="cat-name-ar" dir="rtl" value={c.nameAr ?? ""} onChange={(e) => set("nameAr", e.target.value || undefined)} />
          </Field>
        </div>
        <Field label={t("Description")} htmlFor="cat-desc">
          <Textarea id="cat-desc" value={c.description} onChange={(e) => set("description", e.target.value)} className="min-h-16" />
        </Field>
        <Field label={t("Arabic description")} htmlFor="cat-desc-ar" optional>
          <Textarea id="cat-desc-ar" dir="rtl" lang="ar" value={c.ar?.description ?? ""} onChange={(e) => set("ar", { ...c.ar, description: e.target.value || undefined })} className="min-h-16" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("Group")} htmlFor="cat-kind">
            <Select id="cat-kind" value={c.kind} onChange={(e) => set("kind", e.target.value as CategoryKind)}>
              {(Object.keys(KIND_LABEL) as CategoryKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Icon")} htmlFor="cat-motif">
            <Select id="cat-motif" value={c.motif} onChange={(e) => set("motif", e.target.value as Motif)}>
              {(Object.keys(MOTIF_ICONS) as Motif[]).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Colour")} htmlFor="cat-color">
            <div className="flex items-center gap-2">
              <input id="cat-color" type="color" value={c.color} onChange={(e) => set("color", e.target.value)} className="h-11 w-14 cursor-pointer rounded-xl border border-line bg-surface p-1" />
              <span className="font-mono text-xs text-muted">{c.color}</span>
            </div>
          </Field>
        </div>
        <Switch checked={c.active} onChange={(v) => set("active", v)} label={t("Shown to students")} description={t("Hidden types stay in the catalogue but don’t appear in Explore.")} />
      </div>
    </Dialog>
  );
}

export default function FacilitiesPage() {
  const nav = useNavigate();
  const { get, patch } = useUrlFilters();
  const tab = get("tab") === "types" ? "types" : "facilities";
  const facilities = useAdminFacilities();
  const types = useQuery({ queryKey: ["admin", "categories"], queryFn: () => api.admin.categories() });
  const canManage = useCan("facility.manage");
  const canCategories = useCan("category.manage");
  const [search, setSearch] = useState("");
  const [toggling, setToggling] = useState<Row | null>(null);
  const [editing, setEditing] = useState<FacilityCategory | "new" | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [typeAction, setTypeAction] = useState<TypeAction>(null);
  const showArchived = get("archived") === "1";

  const restore = useMutation({
    mutationFn: (r: Row) => api.admin.restoreFacility(r.facility.id),
    onSuccess: (f) => toast.success(t("{name} restored", { name: facilityName(f) }), f.status === "active" ? t("It’s open for booking again.") : t("It’s back as it was — still closed. Reopen it when it’s ready.")),
    onError: (e) => toast.error(t("Couldn’t restore"), errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (r: Row) => api.admin.deleteFacility(r.facility.id),
    onSuccess: (_x, r) => {
      toast.success(t("{name} deleted", { name: facilityName(r.facility) }));
      setDeleting(null);
    },
  });
  const typeRun = useMutation({
    mutationFn: async ({ kind, category }: { kind: "archive" | "restore" | "delete"; category: FacilityCategory }): Promise<void> => {
      if (kind === "archive") await api.admin.archiveCategory(category.id);
      else if (kind === "restore") await api.admin.restoreCategory(category.id);
      else await api.admin.deleteCategory(category.id);
    },
    onSuccess: (_x, { kind, category }) => {
      toast.success(kind === "archive" ? t("{name} archived", { name: facilityName(category) }) : kind === "restore" ? t("{name} restored", { name: facilityName(category) }) : t("{name} deleted", { name: facilityName(category) }));
      setTypeAction(null);
    },
    onError: (e, { kind }) => {
      if (kind === "restore") toast.error(t("Couldn’t restore"), errorMessage(e));
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ r, reason }: { r: Row; reason?: string }) => api.admin.setFacilityStatus(r.facility.id, r.facility.status === "active" ? "inactive" : "active", reason),
    onSuccess: (res) => {
      toast.success(res.facility.status === "active" ? t("{name} reopened", { name: res.facility.name }) : t("{name} closed", { name: res.facility.name }), res.facility.status === "active" ? t("Students who favourited it have been told.") : res.cancelled ? t("{bookings} cancelled without penalty.", { bookings: N.booking(res.cancelled) }) : t("No upcoming bookings were affected."));
      setToggling(null);
    },
    onError: (e) => toast.error(t("Couldn’t update"), errorMessage(e)),
  });

  const typeRows = types.data ?? [];
  const liveTypes = typeRows.filter((x) => !x.category.archived);
  const archivedTypes = typeRows.filter((x) => x.category.archived);
  const term = search.trim().toLowerCase();
  const archivedCount = (facilities.data ?? []).filter((r) => r.facility.archived).length;
  const rows = (facilities.data ?? []).filter((r) => !!r.facility.archived === showArchived).filter((r) => !term || [r.facility.name, r.facility.nameAr ?? "", r.category.name, r.facility.location.building].some((x) => x.toLowerCase().includes(term)));

  return (
    <div>
      <AdminHeader
        title={t("Facilities")}
        description={t("The catalogue students book from — spaces, opening hours, capacity and facility types.")}
        actions={
          tab === "facilities"
            ? canManage && (
                <Button icon={<Plus className="size-4" />} onClick={() => nav("/admin/facilities/new")}>
                  {t("New facility")}
                </Button>
              )
            : canCategories && (
                <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
                  {t("New type")}
                </Button>
              )
        }
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(v) => patch({ tab: v === "types" ? "types" : null })}
        items={[
          { value: "facilities", label: t("Facilities"), count: facilities.data ? facilities.data.length - archivedCount : undefined, icon: <Building2 className="size-4" /> },
          { value: "types", label: t("Facility types"), count: liveTypes.length || undefined, icon: <Tags className="size-4" /> },
        ]}
      />

      {tab === "facilities" ? (
        facilities.isError ? (
          <ErrorState error={facilities.error} onRetry={() => facilities.refetch()} />
        ) : !facilities.data ? (
          <Skeleton className="h-96 rounded-[20px]" />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <SearchInput value={search} onChange={setSearch} placeholder={t("Search by name, type or building")} label={t("Search facilities")} className="min-w-60 max-w-md flex-1" />
              {(archivedCount > 0 || showArchived) && (
                <Button size="sm" variant={showArchived ? "soft" : "ghost"} icon={<Archive className="size-4" />} aria-pressed={showArchived} onClick={() => patch({ archived: showArchived ? null : "1" })}>
                  {showArchived ? t("Back to current facilities") : t("Archived ({n})", { n: archivedCount })}
                </Button>
              )}
            </div>
            {showArchived && <p className="mb-3 text-sm text-muted">{t("Archived facilities can’t be booked and are hidden from students and staff. Their bookings and history are kept.")}</p>}
            {rows.length === 0 ? (
              <EmptyState icon={Building2} title={showArchived ? t("Nothing archived") : t("No facilities match")} className="rounded-[20px] border border-line bg-surface" />
            ) : (
              <TableShell>
                <thead className="border-b border-line bg-surface-2/60">
                  <tr>
                    <th className={th}>{t("Facility")}</th>
                    <th className={th}>{t("Type")}</th>
                    <th className={th}>{t("Capacity")}</th>
                    <th className={th}>{t("Status")}</th>
                    <th className={cn(th, "text-end")}>{t("Upcoming")}</th>
                    <th className={cn(th, "text-end")}>{t("Issues")}</th>
                    <th className={cn(th, "text-end")}>{t("Own rules")}</th>
                    <th className={th}>
                      <span className="sr-only">{t("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => {
                    const f = r.facility;
                    return (
                      <tr key={f.id} className="transition-colors hover:bg-surface-2/60">
                        <td className={td}>
                          <Link to={`/admin/facilities/${f.id}`} className="flex items-center gap-3">
                            <FacilityArt motif={f.media.motif} accent={f.media.accent} imageUrl={f.media.imageUrl} className="size-11 shrink-0 rounded-xl" dim={f.status !== "active"} />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-ink hover:underline">{facilityName(f)}</span>
                              <span className="block truncate text-xs text-muted">{locationLabel(localFacility(f))}</span>
                            </span>
                          </Link>
                        </td>
                        <td className={td}>
                          <span className="inline-flex items-center gap-1.5 text-ink-2">
                            <span className="size-2 rounded-full" style={{ background: r.category.color }} />
                            {facilityName(r.category)}
                          </span>
                        </td>
                        <td className={cn(td, "text-ink-2")}>
                          <span className="block">{capacityLabel(localFacility(f))}</span>
                          <span className="block text-xs text-muted">{f.sessionMinutes}{t("-min sessions")}</span>
                        </td>
                        <td className={td}>
                          {f.archived ? (
                            <Badge size="xs" icon={<Archive className="size-3" />}>
                              {t("Archived")}
                            </Badge>
                          ) : f.status !== "active" ? (
                            <Badge size="xs" tone="danger" dot>
                              {t("Closed")}
                            </Badge>
                          ) : r.maintenanceNow ? (
                            <Badge size="xs" tone="warning" icon={<Wrench className="size-3" />}>
                              {t("Maintenance")}
                            </Badge>
                          ) : (
                            <Badge size="xs" tone="success" dot>
                              {t("Open")}
                            </Badge>
                          )}
                        </td>
                        <td className={cn(td, "text-end tabular")}>{r.upcomingBookings}</td>
                        <td className={cn(td, "text-end tabular", r.openIssues > 0 && "font-semibold text-warning")}>{r.openIssues}</td>
                        <td className={cn(td, "text-end tabular")}>
                          {r.overrides > 0 ? (
                            <Link to={`/admin/policies?level=facility&id=${f.id}`} className="font-semibold text-brand hover:underline">
                              {r.overrides}
                            </Link>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className={cn(td, "whitespace-nowrap text-end")}>
                          {canManage && f.archived ? (
                            <span className="inline-flex gap-1">
                              <Button size="xs" variant="soft" icon={<ArchiveRestore className="size-3.5" />} loading={restore.isPending && restore.variables?.facility.id === f.id} onClick={() => restore.mutate(r)}>
                                {t("Restore")}
                              </Button>
                              {!r.hasHistory && (
                                <Button size="xs" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(r)}>
                                  {t("Delete")}
                                </Button>
                              )}
                            </span>
                          ) : canManage && (
                            <span className="inline-flex gap-1">
                              <Button size="xs" variant="ghost" onClick={() => nav(`/admin/facilities/${f.id}`)}>
                                {t("Edit")}
                              </Button>
                              {f.status === "active" ? (
                                <Button size="xs" variant="danger-soft" onClick={() => setToggling(r)}>
                                  {t("Close")}
                                </Button>
                              ) : (
                                <Button size="xs" variant="soft" loading={setStatus.isPending && setStatus.variables?.r.facility.id === f.id} onClick={() => setStatus.mutate({ r })}>
                                  {t("Reopen")}
                                </Button>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableShell>
            )}
          </>
        )
      ) : types.isError ? (
        <ErrorState error={types.error} onRetry={() => types.refetch()} />
      ) : !types.data ? (
        <Skeleton className="h-72 rounded-[20px]" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {liveTypes.map(({ category: c, facilities: n, archivedFacilities }) => {
              const Icon = MOTIF_ICONS[c.motif];
              return (
                <article key={c.id} className={cn("flex gap-3.5 rounded-[20px] border border-line bg-surface p-4 shadow-sm", !c.active && "opacity-60")}>
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-white" style={{ background: c.color }}>
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="truncate text-[15px] font-bold text-ink">{facilityName(c)}</h3>
                      {!c.active && <Badge size="xs">{t("Hidden")}</Badge>}
                    </div>
                    <p className="text-xs text-muted">
                      {KIND_LABEL[c.kind]} · {N.facility(n)}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-[13px] text-ink-2">{c.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {canCategories && (
                        <Button size="xs" variant="secondary" onClick={() => setEditing(c)}>
                          {t("Edit")}
                        </Button>
                      )}
                      <Link to={`/admin/policies?level=category&id=${c.id}`} className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold text-brand hover:bg-brand-soft">
                        {t("Booking rules")}
                      </Link>
                      {canCategories && n === 0 && (
                        <Button size="xs" variant="ghost" icon={archivedFacilities === 0 ? <Trash2 className="size-3.5" /> : <Archive className="size-3.5" />} onClick={() => setTypeAction({ kind: archivedFacilities === 0 ? "delete" : "archive", category: c })}>
                          {archivedFacilities === 0 ? t("Delete") : t("Archive")}
                        </Button>
                      )}
                    </div>
                    {canCategories && n > 0 && <p className="mt-2 text-[11px] text-faint">{t("To retire this type, archive or move its facilities first.")}</p>}
                  </div>
                </article>
              );
            })}
          </div>
          {archivedTypes.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
                <Archive className="size-4 text-muted" />
                {t("Archived types")}
              </h2>
              <ul className="divide-y divide-line rounded-[20px] border border-line bg-surface">
                {archivedTypes.map(({ category: c, facilities: n, archivedFacilities }) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{facilityName(c)}</span>
                      <span className="block text-xs text-muted">{L(`${N.facility(archivedFacilities)} archived`, `${N.facility(archivedFacilities)} مؤرشفة`)}</span>
                    </span>
                    {canCategories && (
                      <span className="inline-flex gap-1">
                        <Button size="xs" variant="soft" icon={<ArchiveRestore className="size-3.5" />} loading={typeRun.isPending && typeRun.variables?.kind === "restore" && typeRun.variables.category.id === c.id} onClick={() => typeRun.mutate({ kind: "restore", category: c })}>
                          {t("Restore")}
                        </Button>
                        {n + archivedFacilities === 0 && (
                          <Button size="xs" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setTypeAction({ kind: "delete", category: c })}>
                            {t("Delete")}
                          </Button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <ReasonDialog
        open={!!toggling}
        onClose={() => setToggling(null)}
        title={t("Close {v}?", { v: toggling?.facility.name ?? "" })}
        description={t("It disappears from booking until you reopen it.")}
        presets={[t("Floor resurfacing"), t("Closed for renovation"), t("Equipment replacement"), t("Seasonal closure")]}
        confirmLabel={toggling?.upcomingBookings ? t("Close & cancel {bookings}", { bookings: N.booking(toggling.upcomingBookings) }) : t("Close facility")}
        variant="danger"
        loading={setStatus.isPending}
        onConfirm={(reason) => toggling && setStatus.mutate({ r: toggling, reason })}
      >
        {toggling && toggling.upcomingBookings > 0 && <p className="rounded-xl bg-warning-soft p-3 text-sm text-ink-2">{toggling.upcomingBookings}{" "}{t("upcoming bookings will be cancelled without a strike, and every student is notified with your reason.")}</p>}
      </ReasonDialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t("Delete {name} for good?", { name: deleting ? facilityName(deleting.facility) : "" })}
        description={t("It has never had a booking, waitlist, issue or maintenance entry, so nothing else is affected. This can’t be undone.")}
        confirmLabel={t("Delete facility")}
        danger
        loading={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : undefined}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
      <ConfirmDialog
        open={!!typeAction}
        onClose={() => setTypeAction(null)}
        title={typeAction?.kind === "delete" ? t("Delete {name} for good?", { name: typeAction ? facilityName(typeAction.category) : "" }) : t("Archive {name}?", { name: typeAction ? facilityName(typeAction.category) : "" })}
        description={typeAction?.kind === "delete" ? t("No facility uses this type, so nothing else is affected. This can’t be undone.") : t("It disappears from students and can’t be chosen for new facilities. Its archived facilities keep their history. You can restore it later.")}
        confirmLabel={typeAction?.kind === "delete" ? t("Delete type") : t("Archive type")}
        danger={typeAction?.kind === "delete"}
        loading={typeRun.isPending}
        error={typeRun.isError && typeRun.variables?.kind !== "restore" ? errorMessage(typeRun.error) : undefined}
        onConfirm={() => typeAction && typeRun.mutate(typeAction)}
      />
      <CategoryDialog open={!!editing} category={editing === "new" ? null : editing} onClose={() => setEditing(null)} nextOrder={typeRows.length + 1} />
    </div>
  );
}
