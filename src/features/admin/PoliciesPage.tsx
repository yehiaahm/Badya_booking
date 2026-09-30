import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleSlash, FlaskConical, Info, Lock, MinusCircle, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { api, type Evaluation } from "@/api";
import type { BookingPolicy, NoShowAction, NoShowStep, PolicyOverride } from "@/domain/types";
import { ALL_POLICY_FIELDS, POLICY_SCHEMA, describePolicy, fmtMinutes, getPath, resolvePolicy, setPath, unsetPath, type PolicyField, type PolicyLevel } from "@/domain/policy";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/hooks";
import { errorMessage, usePolicies } from "@/lib/queries";
import { clock, dayKey, fmtRange } from "@/lib/time";
import { useCan } from "@/state/session";
import { POLICY_ICONS } from "@/components/icons";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input, SearchInput, Select, Stepper, Switch } from "@/components/ui/Form";
import { Badge, Card, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { toast } from "@/components/ui/Toast";
import { AdminHeader } from "@/layouts/AdminLayout";
import { useUrlFilters } from "./shared";
import { N, currentLanguage, t, withLanguage } from "@/i18n";
import { facilityName } from "@/domain/localize";

const ACTIONS: { value: NoShowAction; label: string }[] = [
  { value: "warning", get label() {
    return t("Warning");
  } },
  { value: "final_warning", get label() {
    return t("Final warning");
  } },
  { value: "restrict", get label() {
    return t("Pause booking");
  } },
];

const AR_UNITS: Record<string, [string, string, string]> = {
  sessions: ["موعد", "مواعيد", "موعدًا"],
  bookings: ["حجز", "حجوزات", "حجزًا"],
  days: ["يوم", "أيام", "يومًا"],
  people: ["شخص", "أشخاص", "شخصًا"],
  students: ["طالب", "طلاب", "طالبًا"],
  waitlists: ["قائمة", "قوائم", "قائمة"],
  strikes: ["مخالفة", "مخالفات", "مخالفة"],
  min: ["دقيقة", "دقائق", "دقيقة"],
};
const AR_SUFFIX: Record<string, string> = { ahead: "مقدمًا", before: "قبل الموعد", "after start": "بعد البداية" };

/** "bookings" → "booking", "days ahead" → "day ahead", "people" → "person" when the value is 1. */
function unitFor(v: number, unit?: string): string | undefined {
  if (unit && currentLanguage() === "ar") {
    const [w, ...rest] = unit.split(" ");
    const forms = AR_UNITS[w];
    const r = v % 100;
    const noun = !forms ? w : v === 1 ? forms[0] : v === 0 || v === 2 || (r >= 3 && r <= 10) ? forms[1] : forms[2];
    return rest.length ? `${noun} ${AR_SUFFIX[rest.join(" ")] ?? rest.join(" ")}` : noun;
  }
  if (!unit || v !== 1) return unit;
  const [w, ...rest] = unit.split(" ");
  return [w === "people" ? "person" : w.endsWith("s") ? w.slice(0, -1) : w, ...rest].join(" ");
}

function display(field: PolicyField, v: unknown): string {
  if (field.type === "boolean") return v ? t("On") : t("Off");
  if (field.unit === ":00") return `${String(v).padStart(2, "0")}:00`;
  if (field.type === "select") return t(field.options?.find((o) => o.value === v)?.label ?? String(v));
  if (typeof v === "number" && field.unit?.startsWith("min")) {
    const suffix = field.unit.replace("min", "").trim();
    return suffix ? `${fmtMinutes(v)} ${currentLanguage() === "ar" ? (AR_SUFFIX[suffix] ?? suffix) : suffix}` : fmtMinutes(v);
  }
  return `${v}${field.unit ? ` ${unitFor(Number(v), field.unit)}` : ""}`;
}

function PolicyFieldRow({ field, value, inheritedValue, inheritedFrom, overridable, overridden, disabled, onChange, onOverride }: { field: PolicyField; value: unknown; inheritedValue: unknown; inheritedFrom: string; overridable: boolean; overridden: boolean; disabled: boolean; onChange: (v: unknown) => void; onOverride: (on: boolean) => void }) {
  const locked = disabled || (overridable && !overridden);
  const control =
    field.type === "boolean" ? (
      <Switch checked={!!value} disabled={locked} onChange={onChange} label={<span className="sr-only">{t(field.label)}</span>} />
    ) : field.type === "select" ? (
      <div className="inline-flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label={t(field.label)}>
        {field.options!.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={locked} onClick={() => onChange(o.value)} className={cn("h-8 rounded-lg px-3 text-xs font-semibold disabled:cursor-not-allowed", value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted enabled:hover:text-ink")}>
            {t(o.label)}
          </button>
        ))}
      </div>
    ) : locked ? (
      <span className="inline-flex h-11 items-center rounded-xl bg-surface-2 px-4 text-sm font-semibold text-ink-2 tabular">{display(field, value)}</span>
    ) : (
      <Stepper label={t(field.label)} value={Number(value)} min={field.min} max={field.max} step={field.step} unit={unitFor(Number(value), field.unit)} onChange={onChange} />
    );
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 sm:max-w-md">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          {t(field.label)}
          {overridable && overridden && (
            <Badge size="xs" tone="brand">
              {t("Custom")}
            </Badge>
          )}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{t(field.help)}</p>
        {overridable && overridden && <p className="mt-1 text-xs text-faint">{inheritedFrom}: {display(field, inheritedValue)}</p>}
        {field.type === "number" && field.unit?.startsWith("min") && !locked && Number(value) >= 60 && <p className="mt-1 text-xs font-semibold text-ink-2">= {fmtMinutes(Number(value))}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {control}
        {overridable && !disabled && (
          <button type="button" onClick={() => onOverride(!overridden)} className={cn("inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold", overridden ? "text-muted hover:bg-surface-2 hover:text-ink" : "text-brand hover:bg-brand-soft")}>
            {overridden ? (
              <>
                <RotateCcw className="size-3.5" />{" "}{t("Inherit")}
              </>
            ) : (
              t("Customise")
            )}
          </button>
        )}
      </div>
    </li>
  );
}

function LadderEditor({ steps, disabled, onChange }: { steps: NoShowStep[]; disabled: boolean; onChange: (s: NoShowStep[]) => void }) {
  const set = (i: number, patch: Partial<NoShowStep>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 rounded-2xl border border-line p-3">
            <span className="text-sm text-muted">{t("At")}</span>
            <Stepper label={t("Strikes for step {v}", { v: i + 1 })} value={s.strikes} min={1} max={10} unit={unitFor(s.strikes, "strikes")} onChange={(v) => !disabled && set(i, { strikes: v })} />
            <span className="text-sm text-muted">→</span>
            <div className="w-44">
              <Select aria-label={t("Action for step {v}", { v: i + 1 })} value={s.action} disabled={disabled} onChange={(e) => set(i, { action: e.target.value as NoShowAction, restrictDays: e.target.value === "restrict" ? (s.restrictDays ?? 7) : undefined })}>
                {ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </div>
            {s.action === "restrict" && <Stepper label={t("Pause length for step {v}", { v: i + 1 })} value={s.restrictDays ?? 7} min={1} max={90} unit={unitFor(s.restrictDays ?? 7, "days")} onChange={(v) => !disabled && set(i, { restrictDays: v })} />}
            {!disabled && steps.length > 1 && (
              <IconButton label={t("Remove step {v}", { v: i + 1 })} variant="ghost" size="sm" className="ms-auto" onClick={() => onChange(steps.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </IconButton>
            )}
          </li>
        ))}
      </ol>
      {!disabled && (
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} className="mt-2" onClick={() => onChange([...steps, { strikes: (steps.at(-1)?.strikes ?? 0) + 1, action: "restrict", restrictDays: 14 }])}>
          {t("Add step")}
        </Button>
      )}
    </div>
  );
}

function Simulator({ facilityIds, defaultFacility }: { facilityIds: { id: string; name: string }[]; defaultFacility: string }) {
  const [studentQ, setStudentQ] = useState("");
  const [studentId, setStudentId] = useState("");
  const [facilityId, setFacilityId] = useState(defaultFacility);
  const [day, setDay] = useState(() => dayKey(clock.now()));
  const [start, setStart] = useState("");
  useEffect(() => setFacilityId(defaultFacility), [defaultFacility]);
  const sq = useDebounced(studentQ, 250);
  const students = useQuery({ queryKey: ["admin", "sim-students", sq], queryFn: () => api.admin.students({ q: sq }), enabled: sq.trim().length >= 2 });
  const slots = useQuery({ queryKey: ["admin", "sim-slots", facilityId, day], queryFn: () => api.facilities.availability(facilityId, day), enabled: !!facilityId && !!day });
  const sessions = (slots.data?.slots ?? []).filter((s) => s.session.state !== "past");
  useEffect(() => setStart(""), [facilityId, day]);
  const run = useMutation({ mutationFn: () => api.admin.simulate({ userId: studentId, facilityId, start, participantIds: [] }) });
  const r: Evaluation | undefined = run.data;
  const chosen = students.data?.rows.find((x) => x.user.id === studentId);

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-ink">
        <FlaskConical className="size-4 text-brand" />{" "}{t("Test a booking")}
      </h2>
      <p className="mt-0.5 text-sm text-muted">{t("Runs the real rule engine against the saved rules for any student — nothing is booked.")}</p>
      <div className="mt-4 space-y-3">
        <Field label={t("Student")}>
          {chosen ? (
            <div className="flex h-11 items-center justify-between rounded-xl border border-line bg-surface px-3.5 text-sm">
              <span className="truncate font-semibold text-ink">
                {chosen.user.name} <span className="font-normal text-muted">· {chosen.user.universityId}</span>
              </span>
              <button type="button" onClick={() => setStudentId("")} className="text-xs font-semibold text-brand hover:underline">
                {t("Change")}
              </button>
            </div>
          ) : (
            <div>
              <SearchInput value={studentQ} onChange={setStudentQ} placeholder={t("Name or university ID")} label={t("Find a student")} />
              {(students.data?.rows.length ?? 0) > 0 && (
                <ul className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-sm">
                  {students.data!.rows.slice(0, 6).map((s) => (
                    <li key={s.user.id}>
                      <button type="button" onClick={() => setStudentId(s.user.id)} className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-start text-sm hover:bg-surface-2">
                        <span className="truncate text-ink">{s.user.name}</span>
                        <span className="text-xs text-muted tabular">{s.user.universityId}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>
        <Field label={t("Facility")} htmlFor="sim-fac">
          <Select id="sim-fac" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            {facilityIds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("Day")} htmlFor="sim-day">
            <Input id="sim-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label={t("Session")} htmlFor="sim-start">
            <Select id="sim-start" value={start} onChange={(e) => setStart(e.target.value)} disabled={!sessions.length}>
              <option value="">{slots.isFetching ? t("Loading…") : sessions.length ? t("Choose") : t("None")}</option>
              {sessions.map((s) => (
                <option key={s.session.start} value={s.session.start}>
                  {fmtRange(s.session.start, s.session.end)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button block icon={<FlaskConical className="size-4" />} disabled={!studentId || !start} loading={run.isPending} onClick={() => run.mutate()}>
          {t("Run check")}
        </Button>
      </div>

      {run.isError && <p className="mt-4 text-sm text-danger">{errorMessage(run.error)}</p>}
      {r && (
        <div className="mt-5 space-y-3" aria-live="polite">
          <p className={cn("flex items-center gap-2 rounded-xl p-3 text-sm font-bold", r.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
            {r.ok ? <CheckCircle2 className="size-5" /> : <CircleSlash className="size-5" />}
            {r.ok ? (r.warnings.length ? t("Allowed, with warnings") : t("Allowed")) : t("Blocked")}
          </p>
          {[...r.blocking, ...r.warnings].map((x, i) => (
            <div key={i} className="flex gap-2 text-sm">
              {x.severity === "block" ? <CircleSlash className="mt-0.5 size-4 shrink-0 text-danger" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
              <p className="text-ink-2">
                <span className="font-semibold text-ink">{x.title}.</span> {x.message}
              </p>
            </div>
          ))}
          <ul className="grid grid-cols-1 gap-1 border-t border-line pt-3 text-xs sm:grid-cols-2">
            {r.checks.map((c) => (
              <li key={c.id} className={cn("flex items-center gap-1.5", c.status === "skip" ? "text-faint" : "text-ink-2")}>
                {c.status === "pass" ? <CheckCircle2 className="size-3.5 text-success" /> : c.status === "fail" ? <CircleSlash className="size-3.5 text-danger" /> : c.status === "warn" ? <TriangleAlert className="size-3.5 text-warning" /> : <MinusCircle className="size-3.5" />}
                {c.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export default function PoliciesPage() {
  const q = usePolicies();
  const { get, patch } = useUrlFilters();
  const canGlobal = useCan("policy.global.manage");
  const level = (["category", "facility"].includes(get("level")) ? get("level") : "global") as PolicyLevel;
  const scopeId = get("id");
  const d = q.data;

  const cat = level === "category" ? d?.categories.find((c) => c.id === scopeId) : level === "facility" ? d?.categories.find((c) => c.id === d?.facilities.find((f) => f.id === scopeId)?.categoryId) : undefined;
  const fac = level === "facility" ? d?.facilities.find((f) => f.id === scopeId) : undefined;
  const scopeKey = `${level}:${scopeId}`;
  const saved: BookingPolicy | PolicyOverride | undefined = !d ? undefined : level === "global" ? d.global : level === "category" ? cat?.policy : fac?.policy;

  const [draft, setDraft] = useState<BookingPolicy | PolicyOverride | null>(null);
  const [baseline, setBaseline] = useState("");
  const [draftKey, setDraftKey] = useState("");
  useEffect(() => {
    if (saved && draftKey !== scopeKey) {
      setDraft(saved);
      setBaseline(JSON.stringify(saved));
      setDraftKey(scopeKey);
    }
  }, [saved, scopeKey, draftKey]);

  const parent: BookingPolicy | undefined = !d ? undefined : level === "facility" && cat ? resolvePolicy(d.global, cat) : d.global;
  const effective: BookingPolicy | undefined = !d || !draft ? undefined : level === "global" ? (draft as BookingPolicy) : level === "category" && cat ? resolvePolicy(d.global, { ...cat, policy: draft as PolicyOverride }) : fac && cat ? resolvePolicy(d.global, cat, { ...fac, policy: draft as PolicyOverride }) : undefined;
  const readOnly = level === "global" && !canGlobal;
  const dirty = !!draft && draftKey === scopeKey && JSON.stringify(draft) !== baseline;

  // Human-readable "Label: before → after" lines for the audit log, using effective values.
  const buildChanges = () => {
    if (!d || !draft || !baseline) return [] as { label: string; detail: string }[];
    const before = JSON.parse(baseline);
    const resolveWith = (o: BookingPolicy | PolicyOverride): BookingPolicy | undefined => (level === "global" ? (o as BookingPolicy) : level === "category" && cat ? resolvePolicy(d.global, { ...cat, policy: o as PolicyOverride }) : fac && cat ? resolvePolicy(d.global, cat, { ...fac, policy: o as PolicyOverride }) : undefined);
    const was = resolveWith(before);
    const now = resolveWith(draft);
    const out = ALL_POLICY_FIELDS.filter((f) => f.levels.includes(level) && JSON.stringify(getPath(draft, f.path)) !== JSON.stringify(getPath(before, f.path))).map((f) => ({
      label: t(f.label),
      detail: `${t(f.label)}: ${display(f, getPath(was, f.path))} → ${display(f, getPath(now, f.path))}${level !== "global" && getPath(draft, f.path) === undefined ? ` (${t("inherited again")})` : ""}`,
    }));
    if (level === "global" && JSON.stringify((draft as BookingPolicy).noShow.ladder) !== JSON.stringify(before.noShow.ladder)) out.push({ label: t("No-show ladder"), detail: t("No-show ladder updated") });
    return out;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const changes = useMemo(buildChanges, [d, draft, baseline, level, cat, fac]);
  const changed = changes.map((c) => c.label);

  const save = useMutation({
    mutationFn: async () => {
      // The audit log is kept in English.
      const summary = withLanguage("en", () => buildChanges().map((c) => c.detail).join("; ")) || "Updated booking rules";
      if (level === "global") {
        const p = draft as BookingPolicy;
        return api.admin.updateGlobalPolicy({ ...p, noShow: { ...p.noShow, ladder: [...p.noShow.ladder].sort((a, b) => a.strikes - b.strikes) } }, summary);
      }
      if (level === "category") return api.admin.updateCategoryPolicy(cat!.id, draft as PolicyOverride, summary);
      return api.admin.updateFacilityPolicy(fac!.id, draft as PolicyOverride, summary);
    },
    onSuccess: (next) => {
      setDraft(next);
      setBaseline(JSON.stringify(next));
      toast.success(t("Rules saved"), t("They apply to new bookings straight away."));
    },
    onError: (e) => toast.error(t("Couldn’t save"), errorMessage(e)),
  });

  const select = (l: PolicyLevel, id?: string) => patch({ level: l === "global" ? null : l, id: id ?? null });
  const scopeOptions = d ? [{ v: "global:", l: t("Campus defaults") }, ...d.categories.map((c) => ({ v: `category:${c.id}`, l: t("Type · {name}", { name: c.name }) })), ...d.facilities.map((f) => ({ v: `facility:${f.id}`, l: t("Facility · {name}", { name: f.name }) }))] : [];
  const overrideCount = (o: PolicyOverride | undefined) => ALL_POLICY_FIELDS.filter((f) => getPath(o, f.path) !== undefined).length;
  const simFacilities = (d?.facilities ?? []).filter((f) => (level === "facility" ? f.id === scopeId : level === "category" ? f.categoryId === scopeId : true)).map((f) => ({ id: f.id, name: f.name }));

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} className="mt-10" />;

  return (
    <div>
      <AdminHeader title={t("Booking policies")} description={t("Rules resolve from campus defaults, to a facility type, to a single facility — each level only overrides what it changes. Nothing is hard-coded in the booking engine.")} />

      {!d || !draft || !effective || draftKey !== scopeKey ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <Skeleton className="hidden h-96 rounded-[20px] lg:block" />
          <Skeleton className="h-[600px] rounded-[20px]" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label={t("Policy scope")} className="lg:sticky lg:top-24 lg:self-start">
            <div className="lg:hidden">
              <Select aria-label={t("Policy scope")} value={`${level === "global" ? "global" : level}:${level === "global" ? "" : scopeId}`} onChange={(e) => {
                const [l, id] = e.target.value.split(":");
                select(l as PolicyLevel, id || undefined);
              }}>
                {scopeOptions.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </Select>
            </div>
            <div className="hidden max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-[20px] border border-line bg-surface p-2 shadow-sm lg:block">
              <button type="button" onClick={() => select("global")} aria-current={level === "global"} className={cn("flex w-full items-center rounded-xl px-3 py-2 text-start text-sm font-semibold", level === "global" ? "bg-brand-soft text-brand-strong" : "text-ink-2 hover:bg-surface-2")}>
                {t("Campus defaults")}
              </button>
              {d.categories.map((c) => (
                <div key={c.id} className="mt-2">
                  <button type="button" onClick={() => select("category", c.id)} aria-current={level === "category" && scopeId === c.id} className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-start text-[13px] font-semibold", level === "category" && scopeId === c.id ? "bg-brand-soft text-brand-strong" : "text-ink hover:bg-surface-2")}>
                    <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="flex-1 truncate">{c.name}</span>
                    {overrideCount(c.policy) > 0 && <span className="text-[11px] font-bold text-faint">{overrideCount(c.policy)}</span>}
                  </button>
                  {d.facilities
                    .filter((f) => f.categoryId === c.id)
                    .map((f) => (
                      <button key={f.id} type="button" onClick={() => select("facility", f.id)} aria-current={level === "facility" && scopeId === f.id} className={cn("flex w-full items-center gap-2 rounded-xl py-1 ps-7 pe-3 text-start text-[13px]", level === "facility" && scopeId === f.id ? "bg-brand-soft font-semibold text-brand-strong" : "text-muted hover:bg-surface-2 hover:text-ink")}>
                        <span className="flex-1 truncate">{f.name}</span>
                        {overrideCount(f.policy) > 0 && <span className="text-[11px] font-bold text-faint">{overrideCount(f.policy)}</span>}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </nav>

          <div className="min-w-0 space-y-6">
            <Card className="sticky top-16 z-20 flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-ink">{level === "global" ? t("Campus defaults") : level === "category" ? t("{name} — all facilities of this type", { name: cat?.name }) : fac?.name}</h2>
                <p className="text-xs text-muted">{level === "global" ? t("Apply everywhere unless a type or facility overrides them.") : level === "category" ? t("Only customised rules differ from the campus defaults.") : t("Inherits from {name} and the campus defaults.", { name: cat?.name })}</p>
              </div>
              <div className="flex items-center gap-2">
                {readOnly ? (
                  <Badge icon={<Lock className="size-3" />}>{t("Super admins only")}</Badge>
                ) : (
                  <>
                    {dirty && <span className="text-xs font-semibold text-warning">{changed.length ? t("Unsaved: {changes}", { changes: N.change(changed.length) }) : t("Unsaved changes")}</span>}
                    <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setDraft(JSON.parse(baseline))}>
                      {t("Discard")}
                    </Button>
                    <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                      {t("Save rules")}
                    </Button>
                  </>
                )}
              </div>
            </Card>

            {fac && cat && (
              <Card className="p-5">
                <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
                  <Info className="size-4 text-muted" />{" "}{t("What students see")}
                </h3>
                <ul className="mt-3 space-y-1.5">
                  {describePolicy(effective, { facilityName: facilityName(fac), categoryName: facilityName(cat), sessionMinutes: fac.sessionMinutes, mode: fac.mode }).map((l) => {
                    const I = POLICY_ICONS[l.icon] ?? Info;
                    return (
                      <li key={l.text} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
                        <I className={cn("mt-0.5 size-4 shrink-0", l.tone === "fair" ? "text-brand" : "text-muted")} /> {l.text}
                      </li>
                    );
                  })}
                </ul>
                {effective.participants.required && effective.participants.max > fac.capacity && fac.mode === "exclusive" && (
                  <p className="mt-3 flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">
                    <AlertTriangle className="size-4" />{" "}{t("Maximum people (")}{effective.participants.max}{t(") is more than the facility holds (")}{fac.capacity}).
                  </p>
                )}
              </Card>
            )}

            {POLICY_SCHEMA.map((g) => {
              const fields = g.fields.filter((f) => f.levels.includes(level) && (!f.dependsOn || getPath(effective, f.dependsOn)));
              const showLadder = g.id === "noshow" && level === "global";
              if (!fields.length && !showLadder) return null;
              return (
                <Card key={g.id} className="p-5">
                  <h3 className="text-base font-bold text-ink">{t(g.title)}</h3>
                  <p className="text-sm text-muted">{t(g.description)}</p>
                  <ul className="mt-1 divide-y divide-line">
                    {fields.map((field) => {
                      const overridden = level !== "global" && getPath(draft, field.path) !== undefined;
                      return (
                        <PolicyFieldRow
                          key={field.path}
                          field={field}
                          value={getPath(effective, field.path)}
                          inheritedValue={getPath(parent, field.path)}
                          inheritedFrom={level === "facility" ? t("{name} value", { name: cat?.name }) : t("Campus default")}
                          overridable={level !== "global"}
                          overridden={overridden}
                          disabled={readOnly}
                          onChange={(v) => setDraft((x) => setPath((x ?? {}) as object, field.path, v))}
                          onOverride={(on) => setDraft((x) => (on ? setPath((x ?? {}) as object, field.path, getPath(parent, field.path)) : unsetPath((x ?? {}) as object, field.path)))}
                        />
                      );
                    })}
                  </ul>
                  {showLadder && (
                    <div className="mt-4 border-t border-line pt-4">
                      <p className="mb-2 text-sm font-semibold text-ink">{t("Steps")}</p>
                      <LadderEditor steps={(draft as BookingPolicy).noShow.ladder} disabled={readOnly} onChange={(ladder) => setDraft((x) => ({ ...(x as BookingPolicy), noShow: { ...(x as BookingPolicy).noShow, ladder } }))} />
                    </div>
                  )}
                </Card>
              );
            })}

            <Simulator facilityIds={simFacilities.length ? simFacilities : (d.facilities ?? []).map((f) => ({ id: f.id, name: f.name }))} defaultFacility={simFacilities[0]?.id ?? d.facilities[0]?.id ?? ""} />
          </div>
        </div>
      )}
    </div>
  );
}
