import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { SearchX, SlidersHorizontal, X } from "lucide-react";
import type { FacilitySummary } from "@/api";
import type { AmenityKey } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/hooks";
import { useCategories, useFacilities } from "@/lib/queries";
import { AMENITIES, KIND_LABEL } from "@/components/icons";
import { FacilityCard, FacilityCardSkeleton } from "@/components/facility/FacilityCard";
import { Button } from "@/components/ui/Button";
import { SearchInput, Select, Stepper, Switch } from "@/components/ui/Form";
import { EmptyState, ErrorState } from "@/components/ui/Primitives";
import { Sheet } from "@/components/ui/Overlay";
import { PageHeader } from "@/layouts/StudentLayout";
import { N, t as tr, word } from "@/i18n";

type Sort = "recommended" | "available" | "quiet" | "az";
const SORTS: { value: Sort; label: string }[] = [
  { value: "recommended", get label() {
    return tr("Recommended");
  } },
  { value: "available", get label() {
    return tr("Most free today");
  } },
  { value: "quiet", get label() {
    return tr("Least busy");
  } },
  { value: "az", label: "A–Z" },
];

interface Filters {
  avail: boolean;
  open: boolean;
  fav: boolean;
  size: number;
  amenities: AmenityKey[];
}
const NO_FILTERS: Filters = { avail: false, open: false, fav: false, size: 1, amenities: [] };

function readFilters(p: URLSearchParams): Filters {
  return {
    avail: p.get("avail") === "1",
    open: p.get("open") === "1",
    fav: p.get("fav") === "1",
    size: Math.max(1, Number(p.get("size")) || 1),
    amenities: (p.get("am") ?? "").split(",").filter((a): a is AmenityKey => a in AMENITIES),
  };
}

function filterParams(f: Filters): Record<string, string | null> {
  return { avail: f.avail ? "1" : null, open: f.open ? "1" : null, fav: f.fav ? "1" : null, size: f.size > 1 ? String(f.size) : null, am: f.amenities.length ? f.amenities.join(",") : null };
}

const activeCount = (f: Filters) => Number(f.avail) + Number(f.open) + Number(f.fav) + Number(f.size > 1) + f.amenities.length;

function haystack(s: FacilitySummary) {
  const f = s.facility;
  return [f.name, f.nameAr, f.shortDescription, f.location.building, f.location.area, f.location.floor, s.category.name, KIND_LABEL[s.category.kind], ...f.amenities.map((a) => AMENITIES[a].label)].filter(Boolean).join(" ").toLowerCase();
}

const bookableToday = (s: FacilitySummary) => (s.facility.status === "active" && (s.today.state === "open" || s.today.state === "few") ? s.today.bookable : 0);

function applyFilters(list: FacilitySummary[], q: string, cat: string, f: Filters) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((s) => {
    if (cat !== "all" && s.category.id !== cat) return false;
    if (f.fav && !s.isFavorite) return false;
    if (f.avail && bookableToday(s) === 0) return false;
    if (f.open && !(s.openNow && s.facility.status === "active" && !s.maintenanceNow)) return false;
    // Shared spaces are booked one person at a time, so they can't take a group.
    if (f.size > 1 && (s.facility.mode === "shared" || s.facility.capacity < f.size)) return false;
    if (f.amenities.some((a) => !s.facility.amenities.includes(a))) return false;
    if (tokens.length) {
      const h = haystack(s);
      if (!tokens.every((t) => h.includes(t))) return false;
    }
    return true;
  });
}

function sortList(list: FacilitySummary[], sort: Sort) {
  const closed = (s: FacilitySummary) => (s.facility.status !== "active" ? 1 : 0);
  const byName = (a: FacilitySummary, b: FacilitySummary) => a.facility.name.localeCompare(b.facility.name);
  const cmp: Record<Sort, (a: FacilitySummary, b: FacilitySummary) => number> = {
    recommended: (a, b) => Number(bookableToday(b) > 0) - Number(bookableToday(a) > 0) || Number(b.isFavorite) - Number(a.isFavorite) || a.category.sortOrder - b.category.sortOrder || byName(a, b),
    available: (a, b) => bookableToday(b) - bookableToday(a) || byName(a, b),
    quiet: (a, b) => a.utilization7d - b.utilization7d || byName(a, b),
    az: byName,
  };
  return [...list].sort((a, b) => closed(a) - closed(b) || cmp[sort](a, b));
}

function FilterChip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <motion.button layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} type="button" onClick={onRemove} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-brand-soft ps-3 pe-2 text-xs font-semibold text-brand-strong hover:bg-brand-soft/70">
      {children}
      <X className="size-3.5" aria-hidden />
      <span className="sr-only">{tr("Remove filter")}</span>
    </motion.button>
  );
}

export function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const facilities = useFacilities();
  const categories = useCategories();

  const cat = params.get("cat") ?? "all";
  const sort = (SORTS.some((s) => s.value === params.get("sort")) ? params.get("sort") : "recommended") as Sort;
  const filters = useMemo(() => readFilters(params), [params]);

  const patch = (next: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(next)) v ? n.set(k, v) : n.delete(k);
        return n;
      },
      { replace: true },
    );

  // The search box stays responsive; the URL catches up once typing pauses.
  const [text, setText] = useState(params.get("q") ?? "");
  const q = useDebounced(text, 200);
  useEffect(() => {
    if ((params.get("q") ?? "") !== q.trim()) patch({ q: q.trim() || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(filters);
  const openSheet = () => {
    setDraft(filters);
    setSheetOpen(true);
  };

  const all = facilities.data ?? [];
  const results = useMemo(() => sortList(applyFilters(all, q, cat, filters), sort), [all, q, cat, filters, sort]);
  const draftCount = useMemo(() => applyFilters(all, q, cat, draft).length, [all, q, cat, draft]);
  const amenityOptions = useMemo(() => (Object.keys(AMENITIES) as AmenityKey[]).filter((a) => all.some((s) => s.facility.amenities.includes(a))), [all]);
  const maxGroup = useMemo(() => Math.max(2, ...all.filter((s) => s.facility.mode === "exclusive").map((s) => s.facility.capacity)), [all]);
  const nActive = activeCount(filters);
  const filtered = nActive > 0 || cat !== "all" || q.trim() !== "";

  const clearAll = () => {
    setText("");
    patch({ q: null, cat: null, ...filterParams(NO_FILTERS) });
  };

  return (
    <div>
      <PageHeader title={tr("Explore")} subtitle={facilities.data ? tr("{facilities} across campus", { facilities: N.facility(all.filter((s) => s.facility.status === "active").length) }) : undefined} />

      <div className="sticky top-0 z-30 space-y-3 bg-bg/85 px-4 pb-3 pt-1 backdrop-blur-md sm:px-6 lg:top-16">
        <div className="flex gap-2">
          <SearchInput value={text} onChange={setText} placeholder={tr("Search pitches, courts, rooms, buildings…")} label={tr("Search facilities")} className="flex-1" />
          <div className="hidden w-44 shrink-0 sm:block">
            <Select aria-label={tr("Sort by")} value={sort} onChange={(e) => patch({ sort: e.target.value === "recommended" ? null : e.target.value })}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <Button variant={nActive ? "soft" : "secondary"} onClick={openSheet} icon={<SlidersHorizontal className="size-4" />} aria-label={nActive ? tr("Filters, {n} active", { n: nActive }) : tr("Filters")}>
            <span className="hidden sm:inline">{tr("Filters")}</span>
            {nActive > 0 && <span className="ms-0.5 inline-flex size-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-on-brand">{nActive}</span>}
          </Button>
        </div>

        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label={tr("Category")}>
          {[{ id: "all", name: tr("All") }, ...(categories.data ?? [])].map((c) => (
            <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => patch({ cat: c.id === "all" ? null : c.id })} className={cn("relative h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors", cat === c.id ? "text-bg" : "border border-line bg-surface text-ink-2 hover:border-line-strong")}>
              {cat === c.id && <motion.span layoutId="explore-cat" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
              <span className="relative">{c.name}</span>
            </button>
          ))}
        </div>

        {nActive > 0 && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <AnimatePresence initial={false}>
              {filters.avail && <FilterChip key="avail" onRemove={() => patch({ avail: null })}>{tr("Available today")}</FilterChip>}
              {filters.open && <FilterChip key="open" onRemove={() => patch({ open: null })}>{tr("Open now")}</FilterChip>}
              {filters.fav && <FilterChip key="fav" onRemove={() => patch({ fav: null })}>{tr("Favorites")}</FilterChip>}
              {filters.size > 1 && <FilterChip key="size" onRemove={() => patch({ size: null })}>{tr("Group of")}{" "}{filters.size}</FilterChip>}
              {filters.amenities.map((a) => (
                <FilterChip key={a} onRemove={() => patch(filterParams({ ...filters, amenities: filters.amenities.filter((x) => x !== a) }))}>
                  {AMENITIES[a].label}
                </FilterChip>
              ))}
            </AnimatePresence>
            <button type="button" onClick={() => patch(filterParams(NO_FILTERS))} className="h-8 shrink-0 px-2 text-xs font-semibold text-muted hover:text-ink">
              {tr("Clear all")}
            </button>
          </div>
        )}
      </div>

      <div className="px-4 pt-4 sm:px-6">
        {facilities.isError ? (
          <ErrorState error={facilities.error} onRetry={() => facilities.refetch()} />
        ) : !facilities.data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <FacilityCardSkeleton key={i} />
            ))}
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={q.trim() ? tr("Nothing matches “{q}”", { q: q.trim() }) : tr("No facilities match these filters")}
            body={tr("Try a different word, another category, or fewer filters. Building names and amenities work too — try “air-conditioned” or “Activity Center”.")}
            action={
              <Button variant="secondary" onClick={clearAll}>
                {tr("Clear search and filters")}
              </Button>
            }
          />
        ) : (
          <>
            <p className="mb-3 text-sm text-muted" aria-live="polite">
              {filtered ? tr("{n} of {facilities}", { n: results.length, facilities: N.facility(all.length) }) : N.facility(results.length)}
              {q.trim() && (
                <>
                  {" "}
                  {tr("matching")}{" "}<span className="font-semibold text-ink">“{q.trim()}”</span>
                </>
              )}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {results.map((s) => (
                  <FacilityCard key={s.facility.id} s={s} />
                ))}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={tr("Filters")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(NO_FILTERS)} disabled={activeCount(draft) === 0}>
              {tr("Reset")}
            </Button>
            <Button
              onClick={() => {
                patch(filterParams(draft));
                setSheetOpen(false);
              }}
            >
              {draftCount === 0 ? tr("No matches") : tr("Show {facilities}", { facilities: N.facility(draftCount) })}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <div className="space-y-4">
            <Switch checked={draft.avail} onChange={(v) => setDraft({ ...draft, avail: v })} label={tr("Available today")} description={tr("Has at least one session you can still book today.")} />
            <Switch checked={draft.open} onChange={(v) => setDraft({ ...draft, open: v })} label={tr("Open now")} description={tr("Open at this moment, with no maintenance under way.")} />
            <Switch checked={draft.fav} onChange={(v) => setDraft({ ...draft, fav: v })} label={tr("Favorites only")} />
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-line pt-5">
            <div>
              <p className="text-sm font-semibold text-ink">{tr("Group size")}</p>
              <p className="text-xs text-muted">{tr("Shows only spaces that fit your whole group.")}</p>
            </div>
            <Stepper value={draft.size} onChange={(v) => setDraft({ ...draft, size: v })} min={1} max={maxGroup} label={tr("Group size")} unit={word(draft.size, ["person", "people"], ["شخص", "أشخاص", "شخصًا"])} />
          </div>

          {amenityOptions.length > 0 && (
            <fieldset className="border-t border-line pt-5">
              <legend className="mb-3 text-sm font-semibold text-ink">{tr("Amenities")}</legend>
              <div className="flex flex-wrap gap-2">
                {amenityOptions.map((a) => {
                  const { label, icon: I } = AMENITIES[a];
                  const on = draft.amenities.includes(a);
                  return (
                    <button key={a} type="button" aria-pressed={on} onClick={() => setDraft({ ...draft, amenities: on ? draft.amenities.filter((x) => x !== a) : [...draft.amenities, a] })} className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors", on ? "border-brand bg-brand-soft text-brand-strong" : "border-line text-ink-2 hover:border-line-strong")}>
                      <I className="size-3.5" /> {label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div className="border-t border-line pt-5 sm:hidden">
            <p className="mb-3 text-sm font-semibold text-ink">{tr("Sort by")}</p>
            <div className="flex flex-wrap gap-2">
              {SORTS.map((s) => (
                <button key={s.value} type="button" aria-pressed={sort === s.value} onClick={() => patch({ sort: s.value === "recommended" ? null : s.value })} className={cn("h-9 rounded-full border px-3 text-xs font-semibold", sort === s.value ? "border-ink bg-ink text-bg" : "border-line text-ink-2")}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
