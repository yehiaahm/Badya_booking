import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, FileUp, ListChecks, ShieldAlert, Trash2 } from "lucide-react";
import { api, ApiError, type RosterImportReport } from "@/api";
import { cn } from "@/lib/cn";
import { errorMessage, useAppConfig } from "@/lib/queries";
import { fmtAgo } from "@/lib/time";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Overlay";
import { Avatar, Badge, Skeleton } from "@/components/ui/Primitives";
import { toast } from "@/components/ui/Toast";
import { ReasonDialog, downloadCsv } from "./shared";
import { L, N, t, tStored } from "@/i18n";

/** Bigger than any real student list; keeps the upload inside the server's limit. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Excel saves "CSV UTF-8" — or, on Arabic Windows, plain "CSV" in the
 * Windows Arabic code page. Read either, so Arabic names arrive intact.
 */
async function readText(f: File): Promise<string> {
  if (f.size > MAX_FILE_BYTES) throw new ApiError("VALIDATION", t("That file is over 8 MB. Save only the student columns and try again."));
  const bytes = await f.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1256").decode(bytes);
  }
}

type Pending = { name: string; csv: string; report: RosterImportReport };

/* ───────────── Card ───────────── */

/** Admin → Students: the official list that decides who can register, book and be invited. */
export function RosterCard() {
  const qc = useQueryClient();
  const appConfig = useAppConfig();
  const file = useRef<HTMLInputElement>(null);
  const summary = useQuery({ queryKey: ["admin", "roster"], queryFn: () => api.admin.roster() });
  const [pending, setPending] = useState<Pending | null>(null);
  const [clearing, setClearing] = useState(false);
  const preview = useMutation({
    mutationFn: async (f: File): Promise<Pending> => {
      const csv = await readText(f);
      return { name: f.name, csv, report: await api.admin.previewRoster(csv) };
    },
    onSuccess: setPending,
    onError: (e) => toast.error(t("Couldn’t read that file"), errorMessage(e)),
  });
  const upload = useMutation({
    mutationFn: (csv: string) => api.admin.importRoster(csv),
    onSuccess: (r) => {
      qc.invalidateQueries();
      setPending(null);
      toast.success(t("Student list loaded"), t("{count} students. Only they can register, book and be invited now.", { count: r.rows }));
    },
    onError: (e) => {
      // The list changed or the file was edited between preview and load: show what's wrong now.
      const report = e instanceof ApiError ? (e.data as { report?: RosterImportReport } | undefined)?.report : undefined;
      if (report) setPending((p) => (p ? { ...p, report } : p));
      toast.error(t("Couldn’t load the list"), errorMessage(e));
    },
  });
  const clear = useMutation({
    mutationFn: (reason: string) => api.admin.clearRoster(reason),
    onSuccess: () => {
      qc.invalidateQueries();
      setClearing(false);
      toast.info(t("Student list removed"), t("New students can’t register until a list is loaded again. Existing accounts keep working."));
    },
    onError: (e) => toast.error(t("Couldn’t remove the list"), errorMessage(e)),
  });
  const pick = (f: File | undefined) => {
    if (f) preview.mutate(f);
    if (file.current) file.current.value = "";
  };
  const domain = appConfig.data?.allowedEmailDomains[0] ?? "badya.edu.eg";
  const template = () =>
    downloadCsv(
      "badya-student-list.csv",
      ["University ID", "Name", "Arabic name", "Email", "Faculty", "Year", "Level", "Status", "National ID (last 4)"],
      [["20230001", "Ahmed Mohamed Ali", "أحمد محمد علي", `20230001@${domain}`, "Engineering", 2, "Undergraduate", "Active", "1234"]],
    );

  const s = summary.data;
  const loaded = !!s && s.count > 0;
  return (
    <section className={cn("mb-5 rounded-[20px] border p-5", loaded ? "border-line bg-surface" : "border-warning/40 bg-warning-soft")}>
      <div className="flex flex-wrap items-start gap-4">
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl", loaded ? "bg-success-soft text-success" : "bg-surface text-warning")}>
          {loaded ? <ListChecks className="size-5" /> : <ShieldAlert className="size-5" />}
        </span>
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="text-base font-bold text-ink">{t("Official student list")}</h2>
          {!s ? (
            <Skeleton className="mt-2 h-4 w-72 max-w-full" />
          ) : loaded ? (
            <>
              <p className="text-sm text-ink-2">
                {t("{count} students", { count: s.count })}
                {s.updatedAt && ` · ${t("updated {when}", { when: fmtAgo(s.updatedAt) })}`} · {t("{n} have made an account", { n: s.registered })}
                {s.inactive > 0 && ` · ${t("{n} inactive", { n: s.inactive })}`}
              </p>
              {s.withIdCheck < s.count && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-warning">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" />
                  {s.withIdCheck === 0
                    ? t("The list has no national-ID digits, so anyone who knows a student’s university ID and email could register as them. Add a “National ID” column to close this gap.")
                    : L(`${N.student(s.count - s.withIdCheck)} on the list ${s.count - s.withIdCheck === 1 ? "has" : "have"} no national-ID digits and ${s.count - s.withIdCheck === 1 ? "registers" : "register"} without that check.`, `${N.student(s.count - s.withIdCheck)} في القائمة بدون أرقام الرقم القومي، ويتم التسجيل لهم بدون هذا التحقق.`)}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-2">{t("No list loaded — new students can’t register yet. Upload the official list from Student Affairs: only university IDs on it can register, book and be invited.")}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <Button icon={<FileUp className="size-4" />} loading={preview.isPending} onClick={() => file.current?.click()}>
            {loaded ? t("Upload a new list") : t("Upload list (CSV)")}
          </Button>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={template}>
            {t("Template")}
          </Button>
          {loaded && (
            <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setClearing(true)}>
              {t("Remove")}
            </Button>
          )}
        </div>
      </div>
      {loaded && s.outsideCount > 0 && (
        <div className="mt-4 rounded-2xl bg-danger-soft p-3.5">
          <p className="text-sm font-semibold text-ink">{L(`${N.account(s.outsideCount)} ${s.outsideCount === 1 ? "isn’t" : "aren’t"} active on the list — they can’t book or be invited`, `${N.account(s.outsideCount)} غير نشطة في القائمة — لا يمكن لأصحابها الحجز أو تلقي الدعوات`)}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {s.outside.slice(0, 12).map((u) => (
              <li key={u.id} className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-surface ps-1 pe-2.5 text-xs text-ink-2">
                <Avatar name={u.name} hue={u.avatarHue} size={20} />
                <span className="truncate">
                  {u.name} · <span className="tabular">{u.universityId}</span>
                  {u.reason === "inactive" && ` · ${t("inactive")}`}
                </span>
              </li>
            ))}
            {s.outsideCount > 12 && <li className="px-1 text-xs text-muted">{t("and {n} more", { n: s.outsideCount - 12 })}</li>}
          </ul>
        </div>
      )}
      {loaded && s.mismatchCount > 0 && (
        <div className="mt-3 rounded-2xl bg-warning-soft p-3.5">
          <p className="text-sm font-semibold text-ink">{L(`${N.account(s.mismatchCount)} ${s.mismatchCount === 1 ? "uses" : "use"} a different email from the list — check ${s.mismatchCount === 1 ? "it belongs to that student" : "they belong to those students"}`, `${N.account(s.mismatchCount)} ببريد مختلف عن القائمة — تأكد أنها تخص هؤلاء الطلاب`)}</p>
          <ul className="mt-2 space-y-1 text-xs text-ink-2">
            {s.mismatched.slice(0, 8).map((u) => (
              <li key={u.id} className="break-words">
                <span className="font-semibold text-ink">{u.name}</span> · <span className="tabular">{u.universityId}</span> · {u.email} → {u.listedEmail}
              </li>
            ))}
            {s.mismatchCount > 8 && <li className="text-muted">{t("and {n} more", { n: s.mismatchCount - 8 })}</li>}
          </ul>
        </div>
      )}

      <ImportDialog pending={pending} loading={upload.isPending} onClose={() => setPending(null)} onConfirm={() => pending && upload.mutate(pending.csv)} />
      <ReasonDialog
        open={clearing}
        onClose={() => setClearing(false)}
        title={t("Remove the student list?")}
        description={t("New students can’t register until a list is loaded again. Existing accounts keep working.")}
        confirmLabel={t("Remove list")}
        variant="danger"
        loading={clear.isPending}
        onConfirm={(r) => clear.mutate(r)}
      />
    </section>
  );
}

/* ───────────── Preview ───────────── */

function ImportDialog({ pending, loading, onClose, onConfirm }: { pending: Pending | null; loading: boolean; onClose: () => void; onConfirm: () => void }) {
  const r = pending?.report;
  const ok = !!r && r.problemCount === 0;
  const stats: [string, number, ("warning" | "danger")?][] = r
    ? [
        [t("Students in the file"), r.rows],
        [t("New on the list"), r.added],
        [t("Changed"), r.updated],
        [t("Unchanged"), r.unchanged],
        [t("Taken off the list"), r.removed, r.removed ? "warning" : undefined],
        [t("Inactive"), r.inactive],
        [t("With national-ID digits"), r.withIdCheck, r.withIdCheck < r.rows ? "warning" : undefined],
        [t("With email"), r.withEmail],
        [t("Empty lines (ignored)"), r.blank],
        [t("Repeated IDs"), r.duplicates, r.duplicates ? "danger" : undefined],
        [t("Lines with errors"), r.invalid, r.invalid ? "danger" : undefined],
      ]
    : [];
  return (
    <Dialog
      open={!!pending}
      onClose={onClose}
      size="lg"
      title={ok ? t("Replace the student list?") : t("This file needs fixing")}
      description={pending?.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {ok ? t("Cancel") : t("Close")}
          </Button>
          {ok && (
            <Button loading={loading} onClick={onConfirm}>
              {t("Load {n} students", { n: r.rows })}
            </Button>
          )}
        </>
      }
    >
      {r && (
        <div className="space-y-5">
          {!ok && (
            <div role="alert" className="rounded-2xl bg-danger-soft p-3.5">
              <p className="text-sm font-semibold text-ink">{t("Nothing will be loaded until every line can be used. Fix these lines in the spreadsheet and upload it again.")}</p>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm text-ink-2">
                {r.problems.map((p, i) => (
                  <li key={i} className="break-words">
                    {p.message}
                  </li>
                ))}
              </ul>
              {r.problemCount > r.problems.length && <p className="mt-2 text-xs text-muted">{t("Showing the first {n} of {total} problems.", { n: r.problems.length, total: r.problemCount })}</p>}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stats.map(([label, n, tone]) => (
              <div key={label} className="rounded-xl bg-surface-2/70 px-3 py-2">
                <dt className="text-[11px] font-semibold text-muted">{label}</dt>
                <dd className={cn("text-lg font-bold tabular", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink")}>{n}</dd>
              </div>
            ))}
          </dl>

          <div>
            <h3 className="mb-1.5 text-sm font-bold text-ink">{t("Existing accounts")}</h3>
            <ul className="space-y-1 text-sm text-ink-2">
              <li>{L(`${N.account(r.accounts.matched)} on this list; ${N.account(r.accounts.updated)} will take the name, faculty and year from it.`, `${N.account(r.accounts.matched)} في هذه القائمة؛ ${N.account(r.accounts.updated)} ستأخذ الاسم والكلية والسنة منها.`)}</li>
              {r.accounts.keptCorrections > 0 && <li>{L(`${N.account(r.accounts.keptCorrections)} ${r.accounts.keptCorrections === 1 ? "keeps" : "keep"} a faculty or year corrected by the office.`, `${N.account(r.accounts.keptCorrections)} تحتفظ بكلية أو سنة صحّحها المكتب.`)}</li>}
              {r.accounts.outside > 0 && <li className="font-semibold text-danger">{L(`${N.account(r.accounts.outside)} ${r.accounts.outside === 1 ? "isn’t" : "aren’t"} on this list — they won’t be able to book or be invited.`, `${N.account(r.accounts.outside)} غير موجودة في هذه القائمة — لن يتمكن أصحابها من الحجز أو تلقي الدعوات.`)}</li>}
              {r.accounts.inactive > 0 && <li className="font-semibold text-warning">{L(`${N.account(r.accounts.inactive)} ${r.accounts.inactive === 1 ? "is" : "are"} inactive on this list — they won’t be able to book or be invited.`, `${N.account(r.accounts.inactive)} غير نشطة في هذه القائمة — لن يتمكن أصحابها من الحجز أو تلقي الدعوات.`)}</li>}
              {r.accounts.mismatched > 0 && <li className="text-warning">{L(`${N.account(r.accounts.mismatched)} ${r.accounts.mismatched === 1 ? "uses" : "use"} a different email from this list — you’ll be asked to check.`, `${N.account(r.accounts.mismatched)} ببريد مختلف عن هذه القائمة — سيُطلب منك مراجعتها.`)}</li>}
            </ul>
          </div>

          {r.withIdCheck < r.rows && r.rows > 0 && (
            <p className="flex items-start gap-2 rounded-2xl bg-warning-soft p-3 text-xs leading-relaxed text-ink-2">
              <AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
              {t("Students without national-ID digits can register with just their university ID and email. Add a “National ID” column (the full number or its last 4 digits) so only the student can register — the app keeps only a keyed fingerprint of the digits.")}
            </p>
          )}

          {r.sample.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-sm font-bold text-ink">{t("First rows, as read")}</h3>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2/60 text-muted">
                    <tr>
                      <th className="px-2.5 py-2 text-start font-semibold">{t("University ID")}</th>
                      <th className="px-2.5 py-2 text-start font-semibold">{t("Name")}</th>
                      <th className="px-2.5 py-2 text-start font-semibold">{t("Faculty")}</th>
                      <th className="px-2.5 py-2 text-start font-semibold">{t("Year")}</th>
                      <th className="px-2.5 py-2 text-start font-semibold">{t("Status")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {r.sample.map((x) => (
                      <tr key={x.id}>
                        <td className="px-2.5 py-2 tabular">{x.id}</td>
                        <td className="px-2.5 py-2">
                          {x.name && <span className="block">{x.name}</span>}
                          {x.nameAr && (
                            <span dir="rtl" className="block">
                              {x.nameAr}
                            </span>
                          )}
                        </td>
                        <td className="px-2.5 py-2">{tStored(x.faculty) || "—"}</td>
                        <td className="px-2.5 py-2 tabular">{x.year ?? "—"}</td>
                        <td className="px-2.5 py-2">{x.status === "inactive" ? <Badge tone="warning" size="xs">{t("Inactive")}</Badge> : t("Active")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
