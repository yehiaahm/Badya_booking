import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Building2, Plus, Tags, Wrench } from "lucide-react";
import { api } from "@/api";
import type { CategoryKind, FacilityCategory, Motif } from "@/domain/types";
import { cn } from "@/lib/cn";
import { errorMessage, useAdminFacilities, usePolicies } from "@/lib/queries";
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
import { N, t } from "@/i18n";
import { facilityName, localFacility } from "@/domain/localize";

type Row = NonNullable<ReturnType<typeof useAdminFacilities>["data"]>[number];

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
    mutationFn: () => api.admin.saveCategory({ ...c, id: c.id || `c_${slug(c.name)}` }, isNew),
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
        <div className="grid gap-3 sm:grid-cols-2">
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
        <div className="grid gap-3 sm:grid-cols-3">
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
  const policies = usePolicies();
  const canManage = useCan("facility.manage");
  const canCategories = useCan("category.manage");
  const [search, setSearch] = useState("");
  const [toggling, setToggling] = useState<Row | null>(null);
  const [editing, setEditing] = useState<FacilityCategory | "new" | null>(null);

  const setStatus = useMutation({
    mutationFn: ({ r, reason }: { r: Row; reason?: string }) => api.admin.setFacilityStatus(r.facility.id, r.facility.status === "active" ? "inactive" : "active", reason),
    onSuccess: (res) => {
      toast.success(res.facility.status === "active" ? t("{name} reopened", { name: res.facility.name }) : t("{name} closed", { name: res.facility.name }), res.facility.status === "active" ? t("Students who favourited it have been told.") : res.cancelled ? t("{bookings} cancelled without penalty.", { bookings: N.booking(res.cancelled) }) : t("No upcoming bookings were affected."));
      setToggling(null);
    },
    onError: (e) => toast.error(t("Couldn’t update"), errorMessage(e)),
  });

  const categories = policies.data?.categories ?? [];
  const term = search.trim().toLowerCase();
  const rows = (facilities.data ?? []).filter((r) => !term || [r.facility.name, r.category.name, r.facility.location.building].some((x) => x.toLowerCase().includes(term)));
  const countByCat = new Map<string, number>();
  for (const r of facilities.data ?? []) countByCat.set(r.category.id, (countByCat.get(r.category.id) ?? 0) + 1);

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
          { value: "facilities", label: t("Facilities"), count: facilities.data?.length, icon: <Building2 className="size-4" /> },
          { value: "types", label: t("Facility types"), count: categories.length || undefined, icon: <Tags className="size-4" /> },
        ]}
      />

      {tab === "facilities" ? (
        facilities.isError ? (
          <ErrorState error={facilities.error} onRetry={() => facilities.refetch()} />
        ) : !facilities.data ? (
          <Skeleton className="h-96 rounded-[20px]" />
        ) : (
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t("Search by name, type or building")} label={t("Search facilities")} className="mb-4 max-w-md" />
            {rows.length === 0 ? (
              <EmptyState icon={Building2} title={t("No facilities match")} className="rounded-[20px] border border-line bg-surface" />
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
                          {f.status !== "active" ? (
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
                          {canManage && (
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
      ) : policies.isError ? (
        <ErrorState error={policies.error} onRetry={() => policies.refetch()} />
      ) : !policies.data ? (
        <Skeleton className="h-72 rounded-[20px]" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {categories.map((c) => {
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
                    {KIND_LABEL[c.kind]} · {countByCat.get(c.id) ?? 0}{" "}{t("facilities")}
                  </p>
                  <p className="mt-1.5 line-clamp-2 text-[13px] text-ink-2">{c.description}</p>
                  <div className="mt-3 flex gap-1">
                    {canCategories && (
                      <Button size="xs" variant="secondary" onClick={() => setEditing(c)}>
                        {t("Edit")}
                      </Button>
                    )}
                    <Link to={`/admin/policies?level=category&id=${c.id}`} className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold text-brand hover:bg-brand-soft">
                      {t("Booking rules")}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
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
      <CategoryDialog open={!!editing} category={editing === "new" ? null : editing} onClose={() => setEditing(null)} nextOrder={categories.length + 1} />
    </div>
  );
}
