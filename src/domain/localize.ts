import type { Facility, FacilityCategory } from "./types";
import { currentLanguage } from "@/i18n/lang";

/**
 * Facility content in the reader's language. Arabic fields are optional and
 * fall back to English one by one, so a half-translated facility still reads well.
 */
export function localFacility<F extends Facility>(f: F): F {
  if (currentLanguage() !== "ar") return f;
  const a = f.ar ?? {};
  return {
    ...f,
    name: f.nameAr || f.name,
    shortDescription: a.shortDescription || f.shortDescription,
    description: a.description || f.description,
    rules: a.rules?.length ? a.rules : f.rules,
    unitLabel: a.unitLabel || f.unitLabel,
    location: { ...f.location, building: a.building || f.location.building, area: a.area || f.location.area, floor: a.floor || f.location.floor },
    inactiveReason: a.inactiveReason || f.inactiveReason,
  };
}

export function localCategory<C extends FacilityCategory>(c: C): C {
  if (currentLanguage() !== "ar") return c;
  return { ...c, name: c.nameAr || c.name, description: c.ar?.description || c.description };
}

/** Just the name — for sentences built on the server (rules, notifications). */
export const facilityName = (f: { name: string; nameAr?: string }) => (currentLanguage() === "ar" && f.nameAr) || f.name;

const isFacility = (o: Record<string, unknown>) => "unitLabel" in o && "schedule" in o && "categoryId" in o;
const isCategory = (o: Record<string, unknown>) => "motif" in o && "sortOrder" in o && "kind" in o;

/** Localize every facility and category inside an API result (no-op in English). */
export function localizeDeep<T>(value: T): T {
  if (currentLanguage() !== "ar") return value;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype) return v;
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = walk(o[k]);
    if (isFacility(o)) return localFacility(out as unknown as Facility);
    if (isCategory(o)) return localCategory(out as unknown as FacilityCategory);
    return out;
  };
  return walk(value) as T;
}
