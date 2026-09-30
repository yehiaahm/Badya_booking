import { AR } from "@/i18n/ar";
import { L } from "@/i18n/lang";

/**
 * Reading the official student list exported by Student Affairs (CSV from
 * Excel). Columns are found by their header, in English or Arabic; a file
 * without a header row is read as: university ID, name, email, faculty, year.
 *
 * Nothing is skipped silently: every row that can't be used is reported with
 * its line number, so a broken file is fixed and uploaded again instead of
 * half-loaded.
 */

export type RosterColumn = "id" | "name" | "nameAr" | "email" | "faculty" | "year" | "level" | "status" | "nationalId";

/** Header names the export might use. */
const HEADERS: Record<RosterColumn, string[]> = {
  id: ["university id", "universityid", "student id", "student no", "student number", "id", "الرقم الجامعي", "رقم الطالب", "الكود", "كود الطالب"],
  name: ["name", "full name", "english name", "name (english)", "student name", "الاسم بالانجليزية", "الاسم بالإنجليزية"],
  nameAr: ["arabic name", "name (arabic)", "namear", "الاسم", "الاسم بالعربية", "اسم الطالب"],
  email: ["email", "e-mail", "university email", "mail", "البريد", "البريد الإلكتروني", "الإيميل", "الايميل"],
  faculty: ["faculty", "college", "الكلية"],
  year: ["year", "academic year", "السنة", "الفرقة", "المستوى"],
  level: ["level", "degree", "program level", "المرحلة", "الدرجة"],
  status: ["status", "enrolment status", "enrollment status", "active", "الحالة", "حالة القيد"],
  nationalId: ["national id", "national id number", "national id (last 4)", "national id last 4", "last 4 of national id", "nid", "الرقم القومي", "رقم قومي", "الرقم القومي (آخر 4 أرقام)", "آخر 4 أرقام من الرقم القومي"],
};

/** One student as read from the file. `nationalId` is the last 4 digits — the server stores only a keyed hash of it. */
export interface RosterRow {
  id: string;
  name?: string;
  nameAr?: string;
  email?: string;
  faculty?: string;
  year?: number;
  level?: "undergraduate" | "postgraduate";
  status?: "active" | "inactive";
  nationalId?: string;
}

export interface RosterProblem {
  /** Line in the file as a spreadsheet shows it (the header is line 1). 0 = the file as a whole. */
  line: number;
  column: RosterColumn | "file";
  message: string;
  /** A university ID that already appeared higher up. */
  duplicate?: boolean;
}

export interface CheckedRoster {
  rows: RosterRow[];
  problems: RosterProblem[];
  /** Empty lines, ignored. */
  blank: number;
  /** Columns that were recognised. */
  columns: RosterColumn[];
}

/** Split CSV text into rows — quoted cells, comma or semicolon separators, Windows line endings. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0];
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      endRow();
    } else cell += c;
  }
  if (cell || row.length) endRow();
  return rows;
}

/** Arabic-Indic (and Persian) digits → Western, as typed on an Arabic keyboard. */
export const westernDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

/** "Faculty of Engineering", "engineering", "كلية الهندسة" and "هندسة" all mean Engineering. */
function facultyMatcher(faculties: string[]): (raw: string) => string | undefined {
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/^(the\s+)?(faculty|school|college)\s+of\s+/, "")
      .replace(/^كلية\s+/, "")
      .replace(/\s+/g, " ");
  const map = new Map<string, string>();
  for (const f of faculties) {
    map.set(norm(f), f);
    const ar = AR[f];
    if (typeof ar === "string") {
      map.set(norm(ar), f);
      map.set(norm(ar).replace(/^ال/, ""), f);
    }
  }
  return (raw) => map.get(norm(raw)) ?? map.get(norm(raw).replace(/^ال/, ""));
}

const LEVELS: [RegExp, RosterRow["level"]][] = [
  [/^(post ?grad(uate)?|pg|master'?s?|msc|ma|phd|doctorate|دراسات عليا|ماجستير|دكتوراه)$/i, "postgraduate"],
  [/^(under ?grad(uate)?|ug|bachelor'?s?|bsc|ba|بكالوريوس|مرحلة البكالوريوس|جامعي)$/i, "undergraduate"],
];
const STATUSES: [RegExp, RosterRow["status"]][] = [
  [/^(active|enrolled|current|yes|y|1|true|نشط|مقيد|مستمر|منتظم)$/i, "active"],
  [/^(inactive|graduated|withdrawn|suspended|dismissed|left|no|n|0|false|غير نشط|متخرج|منسحب|موقوف|مفصول|غير مقيد)$/i, "inactive"],
];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Read and check the whole file. `faculties` are the app's faculty names;
 * `domains` the university email domains students may register with.
 */
export function checkRoster(text: string, opts: { faculties: string[]; domains: string[] }): CheckedRoster {
  const table = parseCsv(text);
  const problems: RosterProblem[] = [];
  const isBlank = (r: string[]) => r.every((c) => !c.trim());
  const firstLine = table.findIndex((r) => !isBlank(r));
  if (firstLine < 0) return { rows: [], problems: [{ line: 0, column: "file", message: L("The file is empty.", "الملف فارغ.") }], blank: table.length, columns: [] };

  const head = table[firstLine].map((h) => h.trim().toLowerCase());
  const known = (h: string) => Object.values(HEADERS).some((names) => names.includes(h));
  const hasHeader = head.some(known) || !/^\d+$/.test(westernDigits(table[firstLine][0] ?? "").trim());
  const col: Partial<Record<RosterColumn, number>> = {};
  if (hasHeader) {
    for (const [key, names] of Object.entries(HEADERS) as [RosterColumn, string[]][]) {
      const i = head.findIndex((h) => names.includes(h));
      if (i >= 0) col[key] = i;
    }
    if (col.id === undefined) {
      problems.push({ line: firstLine + 1, column: "file", message: L("There’s no “University ID” column. Add one (or use the template) and upload again.", "لا يوجد عمود “الرقم الجامعي”. أضِفه (أو استخدم النموذج) ثم ارفع الملف مرة أخرى.") });
      return { rows: [], problems, blank: 0, columns: Object.keys(col) as RosterColumn[] };
    }
  } else Object.assign(col, { id: 0, name: 1, email: 2, faculty: 3, year: 4 });

  const faculty = facultyMatcher(opts.faculties);
  const rows: RosterRow[] = [];
  const firstSeen = new Map<string, number>();
  let blank = 0;
  const start = hasHeader ? firstLine + 1 : firstLine;
  for (let i = start; i < table.length; i++) {
    const r = table[i];
    const line = i + 1;
    if (isBlank(r)) {
      blank++;
      continue;
    }
    // No real cell is this long; capping it keeps every check below fast on a malformed file.
    const get = (k: RosterColumn) => (col[k] === undefined ? "" : (r[col[k]!] ?? "").trim().slice(0, 320));
    const bad = (column: RosterColumn, en: string, ar: string) => problems.push({ line, column, message: L(`Line ${line}: ${en}`, `السطر ${line}: ${ar}`) });

    const rawId = get("id");
    const id = westernDigits(rawId).replace(/\s/g, "");
    if (!/^\d{5,12}$/.test(id)) {
      bad("id", rawId ? `“${rawId}” isn’t a university ID (5 to 12 digits).` : "the university ID is missing.", rawId ? `“${rawId}” ليس رقمًا جامعيًا (من 5 إلى 12 رقمًا).` : "الرقم الجامعي غير موجود.");
      continue;
    }
    const seen = firstSeen.get(id);
    if (seen) {
      problems.push({ line, column: "id", duplicate: true, message: L(`Line ${line}: university ID ${id} is already on line ${seen}.`, `السطر ${line}: الرقم الجامعي ${id} مكرر (موجود في السطر ${seen}).`) });
      continue;
    }
    firstSeen.set(id, line);

    const row: RosterRow = { id };
    const name = get("name");
    const nameAr = get("nameAr");
    if (name.length > 100) bad("name", "the name is longer than 100 characters.", "الاسم أطول من 100 حرف.");
    else if (name) row.name = name.replace(/\s+/g, " ");
    if (nameAr.length > 100) bad("nameAr", "the Arabic name is longer than 100 characters.", "الاسم العربي أطول من 100 حرف.");
    else if (nameAr) row.nameAr = nameAr.replace(/\s+/g, " ");

    const email = get("email").toLowerCase();
    if (email) {
      const domain = email.split("@")[1] ?? "";
      if (email.length > 254 || !EMAIL.test(email)) bad("email", `“${email}” isn’t an email address.`, `“${email}” ليس بريدًا إلكترونيًا.`);
      else if (!opts.domains.includes(domain)) bad("email", `“${email}” isn’t a university address (${opts.domains.map((d) => "@" + d).join(", ")}).`, `“${email}” ليس بريدًا جامعيًا (${opts.domains.map((d) => "@" + d).join("، ")}).`);
      else row.email = email;
    }

    const rawFaculty = get("faculty");
    if (rawFaculty) {
      const f = faculty(rawFaculty);
      if (f) row.faculty = f;
      else bad("faculty", `“${rawFaculty}” isn’t one of the faculties (${opts.faculties.join(", ")}).`, `“${rawFaculty}” ليست من الكليات المعروفة.`);
    }

    const rawYear = westernDigits(get("year"));
    if (rawYear) {
      const y = Number(rawYear);
      if (Number.isInteger(y) && y >= 1 && y <= 7) row.year = y;
      else bad("year", `the year “${rawYear}” should be a number from 1 to 7.`, `السنة “${rawYear}” يجب أن تكون رقمًا من 1 إلى 7.`);
    }

    const rawLevel = get("level");
    if (rawLevel) {
      const hit = LEVELS.find(([re]) => re.test(rawLevel));
      if (hit) row.level = hit[1];
      else bad("level", `the level “${rawLevel}” should be undergraduate or postgraduate.`, `المرحلة “${rawLevel}” يجب أن تكون بكالوريوس أو دراسات عليا.`);
    }

    const rawStatus = get("status");
    if (rawStatus) {
      const hit = STATUSES.find(([re]) => re.test(rawStatus));
      if (hit) row.status = hit[1];
      else bad("status", `the status “${rawStatus}” should be active or inactive.`, `الحالة “${rawStatus}” يجب أن تكون نشط أو غير نشط.`);
    }

    const rawNid = westernDigits(get("nationalId")).replace(/[\s-]/g, "");
    if (rawNid) {
      if (/^\d{4,20}$/.test(rawNid)) row.nationalId = rawNid.slice(-4);
      else bad("nationalId", "the national ID should be digits (the full number or its last 4).", "الرقم القومي يجب أن يكون أرقامًا (الرقم كاملًا أو آخر 4 أرقام).");
    }
    rows.push(row);
  }
  if (rows.length === 0 && problems.length === 0) problems.push({ line: 0, column: "file", message: L("No students found in the file.", "لم يتم العثور على طلاب في الملف.") });
  return { rows, problems, blank, columns: Object.keys(col) as RosterColumn[] };
}
