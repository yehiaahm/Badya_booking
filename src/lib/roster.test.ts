import { describe, expect, it } from "vitest";
import { checkRoster, parseCsv, westernDigits } from "./roster";

const opts = { faculties: ["Engineering", "Pharmacy", "Computer Science"], domains: ["badya.edu.eg"] };
const bom = String.fromCharCode(0xfeff);

describe("reading the official student list", () => {
  it("reads an Excel CSV with a byte-order mark, Arabic headers, quotes, semicolons and Arabic digits", () => {
    const csv = `${bom}الرقم الجامعي;الاسم;البريد الإلكتروني;الكلية;الفرقة;الحالة\r\n٢٠٢٣٠٠٠١;"أحمد محمد علي";A.Ali@Badya.edu.eg;كلية الهندسة;٢;نشط\r\n20230002;منى حسن;;الصيدلة;3;متخرج\r\n`;
    const r = checkRoster(csv, opts);
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([
      { id: "20230001", nameAr: "أحمد محمد علي", email: "a.ali@badya.edu.eg", faculty: "Engineering", year: 2, status: "active" },
      { id: "20230002", nameAr: "منى حسن", faculty: "Pharmacy", year: 3, status: "inactive" },
    ]);
  });

  it("reads a file with no header row as ID, name, email, faculty, year", () => {
    const r = checkRoster("20230003,Sara Adel,sara@badya.edu.eg,Engineering,1\n20230004,Omar Ali,,Pharmacy,2\n", opts);
    expect(r.rows).toEqual([
      { id: "20230003", name: "Sara Adel", email: "sara@badya.edu.eg", faculty: "Engineering", year: 1 },
      { id: "20230004", name: "Omar Ali", faculty: "Pharmacy", year: 2 },
    ]);
  });

  it("understands English headers in any order, levels, and national IDs (keeping only the last 4 digits)", () => {
    const r = checkRoster('Email,University ID,Name,Level,National ID\n"x@badya.edu.eg",20230005,"Adel, Karim",Postgraduate,2990101-1234567\n', opts);
    expect(r.rows).toEqual([{ id: "20230005", name: "Adel, Karim", email: "x@badya.edu.eg", level: "postgraduate", nationalId: "4567" }]);
  });

  it("reports every unusable line with its line number instead of skipping it", () => {
    const csv = ["University ID,Email,Faculty,Year,Status", "20230006,ok@badya.edu.eg,Engineering,1,active", "", "12,,,,", "20230006,,,,", "20230007,me@gmail.com,,,", "20230008,,Astrology,,", "20230009,,,8,", "20230010,,,,maybe"].join("\n");
    const r = checkRoster(csv, opts);
    expect(r.blank).toBe(1);
    expect(r.problems.map((p) => [p.line, p.column, !!p.duplicate])).toEqual([
      [4, "id", false],
      [5, "id", true],
      [6, "email", false],
      [7, "faculty", false],
      [8, "year", false],
      [9, "status", false],
    ]);
    expect(r.problems[1].message).toMatch(/already on line 2/);
  });

  it("explains a file without an ID column, an empty file and a header with no students", () => {
    expect(checkRoster("Name,Email\nSomeone,x@badya.edu.eg\n", opts).problems[0]).toMatchObject({ column: "file", line: 1 });
    expect(checkRoster("", opts).problems[0].message).toMatch(/empty/);
    expect(checkRoster("University ID,Name\n", opts).problems[0].message).toMatch(/No students/);
  });

  it("stays fast on a malformed file with an enormous cell", () => {
    const huge = `a@${".".repeat(2_000_000)}@`;
    const t0 = performance.now();
    const r = checkRoster(`University ID,Email\n20230011,${huge}\n`, opts);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(r.problems.map((p) => p.column)).toEqual(["email"]);
  });

  it("splits quoted cells with commas, doubled quotes and line breaks", () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\r\nd,e\n')).toEqual([
      ["a", "b, c", 'say "hi"', "two\nlines"],
      ["d", "e"],
    ]);
    expect(westernDigits("٢٠٢٦ و۱۲")).toBe("2026 و12");
  });
});
