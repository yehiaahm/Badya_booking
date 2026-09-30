import { useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { useMutation } from "@tanstack/react-query";
import { ArrowRightLeft, Check, MessageSquareText, Smartphone, SmartphoneNfc, X } from "lucide-react";
import { api, type DeviceRequestView } from "@/api";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { errorMessage, useDeviceRequests } from "@/lib/queries";
import { fmtAgo, fmtDateTime } from "@/lib/time";
import { Button } from "@/components/ui/Button";
import { Avatar, Badge, EmptyState, ErrorState, Skeleton, Tabs } from "@/components/ui/Primitives";
import { toast } from "@/components/ui/Toast";
import { AdminHeader } from "@/layouts/AdminLayout";
import { ReasonDialog, useUrlFilters } from "./shared";
import { L, t, tStored } from "@/i18n";

function RequestCard({ r, onDecide }: { r: DeviceRequestView; onDecide: (r: DeviceRequestView, d: "approved" | "rejected") => void }) {
  const now = useNow(60000);
  const pending = r.status === "pending";
  return (
    <motion.article layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("rounded-[20px] border bg-surface p-5 shadow-sm", pending ? "border-warning/30" : "border-line")}>
      <header className="flex items-start gap-3">
        <Avatar name={r.user.name} hue={r.user.avatarHue} size={40} />
        <div className="min-w-0 flex-1">
          <Link to={`/admin/students?open=${r.user.id}`} className="block truncate text-[15px] font-bold text-ink hover:underline">
            {r.user.name}
          </Link>
          <p className="truncate text-xs text-muted">{[r.user.universityId, tStored(r.user.faculty), r.user.email].filter(Boolean).join(" · ")}</p>
        </div>
        {pending ? (
          <Badge size="xs" tone="warning">
            {t("Waiting")}
          </Badge>
        ) : (
          <Badge size="xs" tone={r.status === "approved" ? "success" : "neutral"}>
            {r.status === "approved" ? t("Approved") : r.status === "rejected" ? t("Declined") : t("Withdrawn")}
          </Badge>
        )}
      </header>

      {r.message && (
        <blockquote className="mt-4 flex gap-2.5 rounded-2xl border border-brand/20 bg-brand-softer p-3.5 text-sm text-ink">
          <MessageSquareText className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>
            <span className="block text-xs font-semibold text-muted">{t("Message from the student")}</span>
            <span className="whitespace-pre-line">{r.message}</span>
          </span>
        </blockquote>
      )}

      <div className="mt-4 rounded-2xl bg-surface-2/70 p-3.5 text-sm">
        <p className="flex items-center gap-2 font-semibold text-ink">
          {r.kind === "device_in_use" ? <ArrowRightLeft className="size-4 text-warning" /> : <SmartphoneNfc className="size-4 text-warning" />}
          {r.kind === "device_in_use" ? t("Wants to use another student’s device") : t("Wants to add a new device")}
        </p>
        <p className="mt-1 text-ink-2">
          {r.kind === "device_in_use" ? (
            <>
              <span className="font-semibold">{r.deviceLabel}</span>{" "}{t("is linked to")}{" "}
              {r.otherUser ? (
                <Link to={`/admin/students?open=${r.otherUser.id}`} className="font-semibold text-brand hover:underline">
                  {r.otherUser.name}
                </Link>
              ) : (
                t("another student")
              )}
              .{pending && ` ${t("Approving moves the device to {to} and signs {from} out of it.", { to: r.user.name.split(" ")[0], from: r.otherUser?.name.split(" ")[0] ?? t("the other student") })}`}
            </>
          ) : (
            <>
              {t("Signing in on")}{" "}<span className="font-semibold">{r.deviceLabel}</span>.{pending && ` ${t("Approving unlinks their current device.")}`}
            </>
          )}
        </p>
        {pending && r.linkedDevices.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {t("Linked now:")}{" "}{r.linkedDevices.map((d) => t("{label} (last used {ago})", { label: d.label, ago: fmtAgo(d.lastSeenAt, now) })).join(L(", ", "، "))}
          </p>
        )}
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {t("Asked")}{" "}{fmtAgo(r.createdAt, now)}
          {!pending && r.decidedAt && ` · ${r.status === "approved" ? t("approved") : r.status === "rejected" ? t("declined") : t("closed")} ${fmtDateTime(r.decidedAt)}${r.decidedByName ? ` ${t("by {name}", { name: r.decidedByName })}` : ""}`}
          {!pending && r.note && ` — ${r.note}`}
        </p>
        {pending && (
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" icon={<X className="size-4" />} onClick={() => onDecide(r, "rejected")}>
              {t("Decline")}
            </Button>
            <Button size="sm" icon={<Check className="size-4" />} onClick={() => onDecide(r, "approved")}>
              {t("Approve")}
            </Button>
          </span>
        )}
      </footer>
    </motion.article>
  );
}

export default function DevicesPage() {
  const q = useDeviceRequests();
  const { get, patch } = useUrlFilters();
  const tab = get("tab") === "recent" ? "recent" : "waiting";
  const [pending, setPending] = useState<{ r: DeviceRequestView; d: "approved" | "rejected" } | null>(null);
  const decide = useMutation({
    mutationFn: ({ r, d, note }: { r: DeviceRequestView; d: "approved" | "rejected"; note: string }) => api.admin.decideDeviceRequest(r.id, d, note || undefined),
    onSuccess: (_x, { r, d }) => {
      toast.success(d === "approved" ? t("Device approved") : t("Request declined"), d === "approved" ? t("{name} can now sign in on {device}.", { name: r.user.name, device: r.deviceLabel }) : t("{name} has been told.", { name: r.user.name }));
      setPending(null);
    },
  });

  const all = q.data ?? [];
  const waiting = all.filter((r) => r.status === "pending");
  const recent = all.filter((r) => r.status !== "pending");
  const list = tab === "recent" ? recent : waiting;

  return (
    <div>
      <AdminHeader
        title={t("Devices")}
        description={t("Each student account works on one device, and each device holds one student account. When someone tries to break that rule — a new phone, or a friend’s account — the sign-in waits here for you.")}
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(v) => patch({ tab: v === "recent" ? "recent" : null })}
        items={[
          { value: "waiting", label: t("Waiting"), count: waiting.length || undefined },
          { value: "recent", label: t("Last 30 days") },
        ]}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-[20px]" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={Smartphone} title={tab === "waiting" ? t("No one is waiting") : t("No decisions in the last 30 days")} body={tab === "waiting" ? t("Device requests appear here the moment a student signs in on a new or shared device.") : undefined} className="rounded-[20px] border border-line bg-surface" />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {list.map((r) => (
            <RequestCard key={r.id} r={r} onDecide={(rr, d) => setPending({ r: rr, d })} />
          ))}
        </div>
      )}

      <ReasonDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending?.d === "approved" ? t("Approve {device}?", { device: pending.r.deviceLabel }) : t("Decline this request?")}
        description={pending ? `${pending.r.user.name} · ${pending.r.user.universityId ?? pending.r.user.email}` : undefined}
        confirmLabel={pending?.d === "approved" ? t("Approve device") : t("Decline")}
        variant={pending?.d === "approved" ? "primary" : "danger"}
        optional
        presets={pending?.d === "approved" ? [t("New phone"), t("Old phone lost or broken"), t("Checked student ID at the office")] : [t("Account sharing is not allowed"), t("Please visit the facilities office with your student ID")]}
        loading={decide.isPending}
        error={decide.isError ? errorMessage(decide.error) : undefined}
        onConfirm={(note) => pending && decide.mutate({ ...pending, note })}
      >
        {pending?.d === "approved" && pending.r.kind === "device_in_use" && <p className="rounded-xl bg-warning-soft p-3 text-sm text-ink-2">{pending.r.otherUser?.name ?? t("The other student")}{" "}{t("will be signed out of this device and will need to use their own.")}</p>}
      </ReasonDialog>
    </div>
  );
}
