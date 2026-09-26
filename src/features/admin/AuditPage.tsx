import { useEffect, useState } from "react";
import { Download, ScrollText } from "lucide-react";
import { api, type AuditQuery } from "@/api";
import type { AuditLog } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/hooks";
import { useAudit } from "@/lib/queries";
import { fmtDateTime } from "@/lib/time";
import { Button } from "@/components/ui/Button";
import { SearchInput, Select } from "@/components/ui/Form";
import { Badge, EmptyState, ErrorState, Skeleton, type Tone } from "@/components/ui/Primitives";
import { AdminHeader } from "@/layouts/AdminLayout";
import { Pagination, TableShell, downloadCsv, td, th, useUrlFilters } from "./shared";
import { t } from "@/i18n";

const ROLES: { value: string; label: string; tone: Tone }[] = [
  { value: "student", get label() {
    return t("Student");
  }, tone: "neutral" },
  { value: "staff", get label() {
    return t("Staff");
  }, tone: "info" },
  { value: "admin", get label() {
    return t("Admin");
  }, tone: "brand" },
  { value: "super_admin", get label() {
    return t("Super admin");
  }, tone: "violet" },
  { value: "system", get label() {
    return t("System");
  }, tone: "dusk" },
];
const ENTITIES: AuditLog["entityType"][] = ["booking", "facility", "category", "policy", "user", "maintenance", "waitlist", "issue", "restriction", "flag", "settings", "role", "session"];

export default function AuditPage() {
  const { get, patch } = useUrlFilters();
  const [text, setText] = useState(get("q"));
  const q = useDebounced(text, 250);
  useEffect(() => {
    if (q.trim() !== get("q")) patch({ q: q.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const query: AuditQuery = { q: get("q") || undefined, role: get("role") || undefined, entityType: get("entity") || undefined, page: Number(get("page")) || 1 };
  const list = useAudit(query);

  const exportAll = async () => {
    const all = await api.admin.audit({ ...query, page: 1, pageSize: 100000 });
    downloadCsv("audit-log.csv", ["Time", "Actor", "Role", "Action", "Entity", "Entity ID", "Summary", "IP"], all.rows.map((a) => [a.at, a.actorName, a.actorRole, a.action, a.entityType, a.entityId, a.summary, a.ip]));
  };

  return (
    <div>
      <AdminHeader
        title={t("Audit log")}
        description={t("Every change to bookings, facilities, rules and people — who did it, when and from where. Entries can’t be edited or deleted.")}
        actions={
          <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={exportAll} disabled={!list.data?.total}>
            {t("Export CSV")}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={text} onChange={setText} placeholder={t("Search summaries, people or IDs")} label={t("Search the audit log")} className="min-w-60 flex-1" />
        <div className="w-44">
          <Select aria-label={t("Role")} value={get("role")} onChange={(e) => patch({ role: e.target.value })}>
            <option value="">{t("All roles")}</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select aria-label={t("Record type")} value={get("entity")} onChange={(e) => patch({ entity: e.target.value })}>
            <option value="">{t("All records")}</option>
            {ENTITIES.map((e) => (
              <option key={e} value={e}>
                {e[0].toUpperCase() + e.slice(1)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data ? (
        <Skeleton className="h-96 rounded-[20px]" />
      ) : list.data.rows.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("No entries match")} body={t("Try a different search or filter.")} className="rounded-[20px] border border-line bg-surface" />
      ) : (
        <>
          <TableShell className={cn(list.isPlaceholderData && "opacity-60")}>
            <thead className="border-b border-line bg-surface-2/60">
              <tr>
                <th className={th}>{t("When")}</th>
                <th className={th}>{t("Who")}</th>
                <th className={th}>{t("What happened")}</th>
                <th className={th}>{t("Record")}</th>
                <th className={th}>{t("IP")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.rows.map((a) => {
                const role = ROLES.find((r) => r.value === a.actorRole);
                return (
                  <tr key={a.id} className="align-top">
                    <td className={cn(td, "whitespace-nowrap text-xs text-muted tabular")}>{fmtDateTime(a.at)}</td>
                    <td className={td}>
                      <span className="block whitespace-nowrap font-semibold text-ink">{a.actorName}</span>
                      {role && (
                        <Badge size="xs" tone={role.tone} className="mt-1">
                          {role.label}
                        </Badge>
                      )}
                    </td>
                    <td className={cn(td, "min-w-72 text-ink-2")}>
                      {a.summary}
                      <span className="mt-0.5 block font-mono text-[11px] text-faint">{a.action}</span>
                    </td>
                    <td className={td}>
                      <span className="block whitespace-nowrap text-ink-2">{a.entityLabel}</span>
                      <span className="block font-mono text-[11px] text-faint">{a.entityId}</span>
                    </td>
                    <td className={cn(td, "whitespace-nowrap font-mono text-[11px] text-faint")}>{a.ip}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => patch({ page: p })} />
        </>
      )}
    </div>
  );
}
