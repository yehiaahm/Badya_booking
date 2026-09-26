import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Copy, MapPin, Plus, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { api, ApiError } from "@/api";
import type { AmenityKey, Audience, BookingMode, Facility, FacilityArabic, Motif } from "@/domain/types";
import { cn } from "@/lib/cn";
import { errorMessage, useAppConfig, usePolicies } from "@/lib/queries";
import { fmtAgo } from "@/lib/time";
import { AMENITIES, MOTIF_ICONS } from "@/components/icons";
import { BRAND_ASSETS } from "@/components/brand/Brand";
import { FacilityArt } from "@/components/facility/FacilityArt";
import { capacityLabel, locationLabel } from "@/components/facility/FacilityCard";
import { Button, IconButton } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select, Stepper, Switch, Textarea } from "@/components/ui/Form";
import { Badge, Card, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { Dialog } from "@/components/ui/Overlay";
import { toast } from "@/components/ui/Toast";
import { AdminHeader } from "@/layouts/AdminLayout";
import { L, t } from "@/i18n";

const DAYS: { i: number; label: string }[] = [
  { i: 6, get label() {
    return t("Saturday");
  } },
  { i: 0, get label() {
    return t("Sunday");
  } },
  { i: 1, get label() {
    return t("Monday");
  } },
  { i: 2, get label() {
    return t("Tuesday");
  } },
  { i: 3, get label() {
    return t("Wednesday");
  } },
  { i: 4, get label() {
    return t("Thursday");
  } },
  { i: 5, get label() {
    return t("Friday");
  } },
];
const AUDIENCES: { value: Audience; label: string }[] = [
  { value: "undergraduate", get label() {
    return t("Undergraduates");
  } },
  { value: "postgraduate", get label() {
    return t("Postgraduates");
  } },
  { value: "faculty_member", get label() {
    return t("Faculty members");
  } },
  { value: "staff", get label() {
    return t("Staff");
  } },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function blankFacility(categoryId: string, motif: Motif, accent: string): Facility {
  return {
    id: "",
    name: "",
    categoryId,
    shortDescription: "",
    description: "",
    location: { building: "", area: "", mapX: 50, mapY: 50 },
    media: { motif, accent },
    mode: "exclusive",
    units: 1,
    unitLabel: "court",
    capacity: 10,
    sessionMinutes: 60,
    turnoverMinutes: 0,
    schedule: Array.from({ length: 7 }, () => ({ open: "08:00", close: "22:00" })),
    amenities: [],
    rules: [],
    policy: {},
    access: { audiences: ["undergraduate", "postgraduate"], faculties: null, minYear: null },
    status: "active",
    createdAt: "",
    updatedAt: "",
  };
}

function Section({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return (
    <Card id={id} className="scroll-mt-24 p-5 sm:p-6">
      <h2 className="text-base font-bold text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </Card>
  );
}

export default function FacilityEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const policies = usePolicies();
  const appConfig = useAppConfig();
  const existing = useQuery({ queryKey: ["admin", "facility", id], queryFn: () => api.admin.facility(id!), enabled: !isNew });
  const [f, setF] = useState<Facility | null>(null);
  const [baseline, setBaseline] = useState("");
  const [newRule, setNewRule] = useState("");

  // Same component instance across /admin/facilities/:id — start over when the id changes.
  useEffect(() => {
    setF(null);
    setBaseline("");
  }, [id]);

  // Initialise the form once its source data arrives.
  useEffect(() => {
    if (f) return;
    if (!isNew && existing.data) {
      setF(existing.data.facility);
      setBaseline(JSON.stringify(existing.data.facility));
    } else if (isNew && policies.data) {
      const c = policies.data.categories[0];
      const blank = blankFacility(c?.id ?? "", c?.motif ?? "generic", c?.color ?? "#b8743f");
      setF(blank);
      setBaseline(JSON.stringify(blank));
    }
  }, [f, isNew, existing.data, policies.data]);

  const dirty = !!f && JSON.stringify(f) !== baseline;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (x: Facility) => api.admin.saveFacility({ ...x, id: x.id || `f_${slug(x.name)}`, ar: x.ar && { ...x.ar, rules: x.ar.rules?.map((r) => r.trim()).filter(Boolean) } }, isNew),
    onSuccess: (saved) => {
      setF(saved);
      setBaseline(JSON.stringify(saved));
      toast.success(isNew ? t("{name} created", { name: saved.name }) : t("Changes saved"), isNew ? t("It’s live for students now.") : undefined);
      if (isNew) setTimeout(() => nav(`/admin/facilities/${saved.id}`, { replace: true }), 0);
    },
  });
  const errors = save.error instanceof ApiError ? ((save.error.data as { errors?: string[] } | undefined)?.errors ?? [save.error.message]) : save.error ? [errorMessage(save.error)] : [];

  const category = useMemo(() => policies.data?.categories.find((c) => c.id === f?.categoryId), [policies.data, f?.categoryId]);

  if (existing.isError) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} className="mt-10" />;
  if (!f || !policies.data)
    return (
      <div className="space-y-4 pt-8">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 rounded-[20px]" />
        <Skeleton className="h-64 rounded-[20px]" />
      </div>
    );

  const set = <K extends keyof Facility>(k: K, v: Facility[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const setLoc = (patch: Partial<Facility["location"]>) => set("location", { ...f.location, ...patch });
  const setAr = (patch: Partial<FacilityArabic>) => set("ar", { ...(f.ar ?? {}), ...patch });
  const setDay = (i: number, v: Facility["schedule"][number]) => set("schedule", f.schedule.map((d, j) => (j === i ? v : d)));
  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const MotifIcon = MOTIF_ICONS[f.media.motif];

  return (
    <div>
      <AdminHeader
        title={
          <span className="flex items-center gap-2">
            <IconButton label={t("Back to facilities")} variant="ghost" size="sm" onClick={() => nav("/admin/facilities")}>
              <ArrowLeft className="size-5" />
            </IconButton>
            {isNew ? t("New facility") : f.name || t("Untitled facility")}
          </span>
        }
        badge={!isNew && (f.status === "active" ? <Badge tone="success" dot>{t("Open")}</Badge> : <Badge tone="danger" dot>{t("Closed")}</Badge>)}
        description={isNew ? t("Students can book it as soon as you save.") : t("Last updated {ago}.", { ago: fmtAgo(f.updatedAt) })}
        actions={
          <>
            {dirty && <span className="text-xs font-semibold text-warning">{t("Unsaved changes")}</span>}
            <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setF(JSON.parse(baseline))}>
              {t("Discard")}
            </Button>
            <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(f)}>
              {isNew ? t("Create facility") : t("Save changes")}
            </Button>
          </>
        }
      />

      {errors.length > 0 && (
        <div role="alert" className="mb-5 flex gap-3 rounded-2xl border border-danger/25 bg-danger-soft p-4 text-sm">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" />
          <ul className="space-y-0.5 text-ink-2">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Section title={t("Basics")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("Name")} htmlFor="fe-name">
                <Input id="fe-name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("e.g. Padel Courts")} />
              </Field>
              <Field label={t("Arabic name")} htmlFor="fe-name-ar" optional>
                <Input id="fe-name-ar" dir="rtl" value={f.nameAr ?? ""} onChange={(e) => set("nameAr", e.target.value || undefined)} />
              </Field>
              <Field label={t("Facility type")} htmlFor="fe-cat">
                <Select id="fe-cat" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                  {policies.data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.active ? "" : ` (${t("hidden")})`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("One-line summary")} htmlFor="fe-short" hint={t("{length}/120 — shown on cards in Explore.", { length: f.shortDescription.length })}>
                <Input id="fe-short" value={f.shortDescription} maxLength={120} onChange={(e) => set("shortDescription", e.target.value)} />
              </Field>
            </div>
            <Field label={t("Description")} htmlFor="fe-desc" className="mt-4">
              <Textarea id="fe-desc" value={f.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
          </Section>

          <Section title={t("Location")} description={t("Where students go — and where the pin sits on the campus map.")}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("Building")} htmlFor="fe-building">
                <Input id="fe-building" value={f.location.building} onChange={(e) => setLoc({ building: e.target.value })} placeholder={t("Sports Courts")} />
              </Field>
              <Field label={t("Area")} htmlFor="fe-area" optional>
                <Input id="fe-area" value={f.location.area ?? ""} onChange={(e) => setLoc({ area: e.target.value || undefined })} placeholder={t("Racket Courts")} />
              </Field>
              <Field label={t("Floor")} htmlFor="fe-floor" optional>
                <Input id="fe-floor" value={f.location.floor ?? ""} onChange={(e) => setLoc({ floor: e.target.value || undefined })} placeholder={t("Level 2")} />
              </Field>
            </div>
            <p className="mb-2 mt-5 text-[13px] font-semibold text-ink">{t("Map position")}</p>
            <button
              type="button"
              aria-label={t("Click to place the facility on the campus map")}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setLoc({ mapX: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, mapY: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10 });
              }}
              className="relative block w-full cursor-crosshair overflow-hidden rounded-2xl border border-line"
            >
              <img src={BRAND_ASSETS.campus} alt="" className="aspect-[16/8] w-full object-cover" draggable={false} />
              <span className="absolute inset-0 bg-black/15" />
              <span className="absolute -translate-x-1/2 -translate-y-full" style={{ left: `${f.location.mapX}%`, top: `${f.location.mapY}%` }}>
                <MapPin className="size-7 fill-brand text-white drop-shadow" />
              </span>
            </button>
            <p className="mt-1.5 text-xs text-muted">{t("Click the map to move the pin.")}</p>
          </Section>

          <Section title={t("Booking setup")} description={t("How the space is shared and how long each session lasts.")}>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("Booking mode")}>
              {(
                [
                  { v: "exclusive", t: t("Whole space per booking"), d: t("A group books a court, pitch or room for themselves. Several identical spaces can share one listing.") },
                  { v: "shared", t: t("Individual spots"), d: t("Each student books one spot in a shared session — for open-play times.") },
                ] as { v: BookingMode; t: string; d: string }[]
              ).map((o) => (
                <button key={o.v} type="button" role="radio" aria-checked={f.mode === o.v} onClick={() => setF({ ...f, mode: o.v, unitLabel: o.v === "shared" ? "spot" : f.unitLabel === "spot" ? "court" : f.unitLabel })} className={cn("rounded-2xl border p-4 text-start transition-colors", f.mode === o.v ? "border-brand bg-brand-softer ring-2 ring-brand/15" : "border-line hover:border-line-strong")}>
                  <span className="block text-sm font-bold text-ink">{o.t}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">{o.d}</span>
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-ink">{f.mode === "shared" ? t("Spots per session") : t("Identical spaces")}</p>
                  <p className="text-xs text-muted">{f.mode === "shared" ? t("How many students per session.") : t("e.g. 2 padel courts under one listing.")}</p>
                </div>
                <Stepper label={f.mode === "shared" ? t("Spots per session") : t("Identical spaces")} value={f.units} min={1} max={200} onChange={(v) => set("units", v)} />
              </div>
              <Field label={t("Each one is called a…")} htmlFor="fe-unit" hint={L(`Shown as “${f.units} ${f.unitLabel}${f.units === 1 ? "" : "s"}”.`, `يظهر للطلاب بالإنجليزية كـ “${f.units} ${f.unitLabel}${f.units === 1 ? "" : "s"}”.`)}>
                <Input id="fe-unit" value={f.unitLabel} onChange={(e) => set("unitLabel", e.target.value.toLowerCase())} />
              </Field>
              {f.mode === "exclusive" && (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-ink">{t("People per booking")}</p>
                    <p className="text-xs text-muted">{t("Maximum group size, including the booker.")}</p>
                  </div>
                  <Stepper label={t("People per booking")} value={f.capacity} min={1} max={60} unit={t("max")} onChange={(v) => set("capacity", v)} />
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-ink">{t("Session length")}</p>
                  <p className="text-xs text-muted">{t("Minimum 15 minutes.")}</p>
                </div>
                <Stepper label={t("Session length")} value={f.sessionMinutes} min={15} max={240} step={15} unit={t("min")} onChange={(v) => set("sessionMinutes", v)} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-ink">{t("Turnover between sessions")}</p>
                  <p className="text-xs text-muted">{t("Cleaning or set-up time. Sessions never overlap it.")}</p>
                </div>
                <Stepper label={t("Turnover")} value={f.turnoverMinutes} min={0} max={60} step={5} unit={t("min")} onChange={(v) => set("turnoverMinutes", v)} />
              </div>
            </div>
          </Section>

          <Section title={t("Opening hours")} description={t("Sessions are generated inside these hours every week.")}>
            <ul className="divide-y divide-line">
              {DAYS.map(({ i, label }) => {
                const h = f.schedule[i];
                return (
                  <li key={i} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="w-28 text-sm font-semibold text-ink">{label}</span>
                    <Switch checked={!!h} onChange={(on) => setDay(i, on ? { open: "08:00", close: "22:00" } : null)} label={<span className="sr-only">{t("Open on")}{" "}{label}</span>} />
                    {h ? (
                      <span className="flex items-center gap-2">
                        <span className="w-32">
                          <Input type="time" aria-label={t("{label} opens", { label })} value={h.open} onChange={(e) => setDay(i, { ...h, open: e.target.value })} />
                        </span>
                        <span className="text-muted">–</span>
                        <span className="w-32">
                          <Input type="time" aria-label={t("{label} closes", { label })} value={h.close} onChange={(e) => setDay(i, { ...h, close: e.target.value })} invalid={h.close <= h.open} />
                        </span>
                      </span>
                    ) : (
                      <span className="text-sm text-muted">{t("Closed")}</span>
                    )}
                    {h && i === DAYS[0].i && (
                      <Button size="xs" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => set("schedule", f.schedule.map((d) => (d ? { ...h } : d)))}>
                        {t("Copy to open days")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title={t("Amenities")}>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(AMENITIES) as AmenityKey[]).map((a) => {
                const { label, icon: I } = AMENITIES[a];
                const on = f.amenities.includes(a);
                return (
                  <button key={a} type="button" aria-pressed={on} onClick={() => set("amenities", toggleIn(f.amenities, a))} className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors", on ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-ink-2 hover:border-line-strong")}>
                    <I className="size-3.5" /> {label}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title={t("House rules")} description={t("Shown to students before they confirm a booking.")}>
            <ul className="space-y-2">
              {f.rules.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Input aria-label={t("Rule {v}", { v: i + 1 })} value={r} onChange={(e) => set("rules", f.rules.map((x, j) => (j === i ? e.target.value : x)))} />
                  <IconButton label={t("Remove rule {v}", { v: i + 1 })} variant="ghost" size="sm" onClick={() => set("rules", f.rules.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newRule.trim()) return;
                set("rules", [...f.rules, newRule.trim()]);
                setNewRule("");
              }}
            >
              <Input aria-label={t("New rule")} value={newRule} onChange={(e) => setNewRule(e.target.value)} placeholder={t("e.g. Non-marking shoes only")} />
              <Button type="submit" variant="secondary" icon={<Plus className="size-4" />} disabled={!newRule.trim()}>
                {t("Add")}
              </Button>
            </form>
          </Section>

          <Section title={t("Arabic content")} description={t("Shown to students who use the app in Arabic. Anything left empty falls back to the English text.")}>
            <div dir="rtl" lang="ar" className="grid gap-4 sm:grid-cols-2">
              <Field label={t("One-line summary")} htmlFor="fe-ar-short" optional>
                <Input id="fe-ar-short" value={f.ar?.shortDescription ?? ""} maxLength={120} onChange={(e) => setAr({ shortDescription: e.target.value || undefined })} />
              </Field>
              <Field label={t("Each one is called a…")} htmlFor="fe-ar-unit" optional hint={t("Singular, e.g. ملعب or ترابيزة.")}>
                <Input id="fe-ar-unit" value={f.ar?.unitLabel ?? ""} maxLength={30} onChange={(e) => setAr({ unitLabel: e.target.value || undefined })} />
              </Field>
            </div>
            <div dir="rtl" lang="ar">
              <Field label={t("Description")} htmlFor="fe-ar-desc" className="mt-4" optional>
                <Textarea id="fe-ar-desc" value={f.ar?.description ?? ""} onChange={(e) => setAr({ description: e.target.value || undefined })} />
              </Field>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label={t("Building")} htmlFor="fe-ar-building" optional>
                  <Input id="fe-ar-building" value={f.ar?.building ?? ""} onChange={(e) => setAr({ building: e.target.value || undefined })} />
                </Field>
                <Field label={t("Area")} htmlFor="fe-ar-area" optional>
                  <Input id="fe-ar-area" value={f.ar?.area ?? ""} onChange={(e) => setAr({ area: e.target.value || undefined })} />
                </Field>
                <Field label={t("Floor")} htmlFor="fe-ar-floor" optional>
                  <Input id="fe-ar-floor" value={f.ar?.floor ?? ""} onChange={(e) => setAr({ floor: e.target.value || undefined })} />
                </Field>
              </div>
              <Field label={t("House rules")} htmlFor="fe-ar-rules" className="mt-4" optional hint={t("One rule per line.")}>
                <Textarea
                  id="fe-ar-rules"
                  value={(f.ar?.rules ?? []).join("\n")}
                  onChange={(e) => setAr({ rules: e.target.value.split("\n").map((x) => x.trimStart()).filter((x, i, all) => x || i === all.length - 1).slice(0, 20) })}
                  onBlur={() => setAr({ rules: (f.ar?.rules ?? []).map((x) => x.trim()).filter(Boolean) })}
                  className="min-h-28"
                />
              </Field>
            </div>
          </Section>

          <Section title={t("Who can book")}>
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold text-ink">{t("Audiences")}</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {AUDIENCES.map((a) => (
                  <Checkbox key={a.value} checked={f.access.audiences.includes(a.value)} onChange={() => set("access", { ...f.access, audiences: toggleIn(f.access.audiences, a.value) })} label={a.label} />
                ))}
              </div>
            </fieldset>
            <fieldset className="mt-5">
              <legend className="mb-2 text-[13px] font-semibold text-ink">{t("Faculties")}</legend>
              <Switch checked={f.access.faculties === null} onChange={(all) => set("access", { ...f.access, faculties: all ? null : [] })} label={t("Open to every faculty")} />
              {f.access.faculties !== null && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(appConfig.data?.faculties ?? []).map((fac) => {
                    const on = f.access.faculties!.includes(fac);
                    return (
                      <button key={fac} type="button" aria-pressed={on} onClick={() => set("access", { ...f.access, faculties: toggleIn(f.access.faculties!, fac) })} className={cn("h-8 rounded-full border px-3 text-xs font-semibold", on ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-ink-2")}>
                        {fac}
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>
            <div className="mt-5 w-56">
              <Field label={t("Minimum year")} htmlFor="fe-year">
                <Select id="fe-year" value={f.access.minYear ?? ""} onChange={(e) => set("access", { ...f.access, minYear: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">{t("Any year")}</option>
                  {[2, 3, 4, 5].map((y) => (
                    <option key={y} value={y}>
                      {t("Year")}{" "}{y}{" "}{t("and above")}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Card className="overflow-hidden">
            <FacilityArt motif={f.media.motif} accent={f.media.accent} imageUrl={f.media.imageUrl} className="aspect-[16/10] w-full" />
            <div className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{category?.name}</p>
              <p className="text-base font-bold text-ink">{f.name || t("Facility name")}</p>
              <p className="text-xs text-muted">{locationLabel(f) || t("Building")}</p>
              <p className="mt-2 text-xs font-medium text-ink-2">
                {capacityLabel(f)} · {f.sessionMinutes}{" "}{t("min")}
              </p>
            </div>
          </Card>
          <Card className="space-y-3 p-4">
            <p className="text-sm font-bold text-ink">{t("Cover art")}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Plan style")} htmlFor="fe-motif">
                <Select id="fe-motif" value={f.media.motif} onChange={(e) => set("media", { ...f.media, motif: e.target.value as Motif })}>
                  {(Object.keys(MOTIF_ICONS) as Motif[]).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("Colour")} htmlFor="fe-accent">
                <div className="flex items-center gap-2">
                  <input id="fe-accent" type="color" value={f.media.accent} onChange={(e) => set("media", { ...f.media, accent: e.target.value })} className="h-11 w-full cursor-pointer rounded-xl border border-line bg-surface p-1" />
                  <MotifIcon className="size-5 shrink-0 text-muted" aria-hidden />
                </div>
              </Field>
            </div>
            <Field label={t("Photo URL")} htmlFor="fe-img" optional hint={t("Replaces the plan art with a photo.")}>
              <Input id="fe-img" type="url" value={f.media.imageUrl ?? ""} onChange={(e) => set("media", { ...f.media, imageUrl: e.target.value || undefined })} placeholder={t("https://")} />
            </Field>
          </Card>
          {!isNew && (
            <Card className="space-y-2 p-4">
              <Link to={`/admin/policies?level=facility&id=${f.id}`} className="flex items-center gap-2 text-sm font-semibold text-brand hover:underline">
                <ShieldCheck className="size-4" />{" "}{t("Booking rules for this facility")}
              </Link>
              <Link to={`/admin/maintenance`} className="flex items-center gap-2 text-sm font-semibold text-brand hover:underline">
                <Wrench className="size-4" />{" "}{t("Schedule maintenance")}
              </Link>
            </Card>
          )}
          {!isNew && existing.data && existing.data.issues.length > 0 && (
            <Card className="p-4">
              <p className="mb-2 text-sm font-bold text-ink">{t("Reported issues")}</p>
              <ul className="space-y-2">
                {existing.data.issues.slice(0, 5).map((i) => (
                  <li key={i.id} className="text-sm">
                    <span className="block text-ink-2">{i.description}</span>
                    <span className="text-xs text-muted">
                      {i.severity} · {i.status.replace("_", " ")} · {fmtAgo(i.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      <Dialog
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        size="sm"
        title={t("Discard your changes?")}
        description={t("You have unsaved changes to this facility.")}
        footer={
          <>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              {t("Keep editing")}
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              {t("Discard")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">{t("Leaving now loses everything you’ve changed since the last save.")}</p>
      </Dialog>
    </div>
  );
}
