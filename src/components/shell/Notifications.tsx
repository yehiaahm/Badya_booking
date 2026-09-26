import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { useMutation } from "@tanstack/react-query";
import { Bell, BellOff, CalendarCheck, CalendarX, CheckCircle2, Clock, Hourglass, ListOrdered, Megaphone, ShieldAlert, Smartphone, Sparkles, UserPlus, UserX, Wrench, type LucideIcon } from "lucide-react";
import { api, type AppNotification } from "@/api";
import type { NotificationType } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useIsDesktop, useNow } from "@/lib/hooks";
import { useNotifications } from "@/lib/queries";
import { countdown, fmtAgo, isToday } from "@/lib/time";
import { EmptyState, Skeleton } from "@/components/ui/Primitives";
import { Button, IconButton } from "@/components/ui/Button";
import { t } from "@/i18n";

const META: Record<NotificationType, { icon: LucideIcon; tone: string }> = {
  booking_confirmed: { icon: CalendarCheck, tone: "bg-success-soft text-success" },
  booking_pending: { icon: Hourglass, tone: "bg-warning-soft text-warning" },
  booking_approved: { icon: CheckCircle2, tone: "bg-success-soft text-success" },
  booking_rejected: { icon: CalendarX, tone: "bg-surface-2 text-muted" },
  booking_reminder: { icon: Clock, tone: "bg-info-soft text-info" },
  booking_cancelled: { icon: CalendarX, tone: "bg-surface-2 text-muted" },
  participant_added: { icon: UserPlus, tone: "bg-brand-soft text-brand" },
  waitlist_joined: { icon: ListOrdered, tone: "bg-violet-soft text-violet" },
  slot_available: { icon: Sparkles, tone: "bg-brand text-on-brand" },
  waitlist_expired: { icon: ListOrdered, tone: "bg-surface-2 text-muted" },
  checkin_success: { icon: CheckCircle2, tone: "bg-success-soft text-success" },
  noshow_warning: { icon: UserX, tone: "bg-danger-soft text-danger" },
  restriction: { icon: ShieldAlert, tone: "bg-danger-soft text-danger" },
  maintenance: { icon: Wrench, tone: "bg-warning-soft text-warning" },
  facility_reopened: { icon: Megaphone, tone: "bg-success-soft text-success" },
  fairness_notice: { icon: ShieldAlert, tone: "bg-warning-soft text-warning" },
  device_request: { icon: Smartphone, tone: "bg-warning-soft text-warning" },
  device_decision: { icon: Smartphone, tone: "bg-info-soft text-info" },
};

function Item({ n, onOpen }: { n: AppNotification; onOpen: (n: AppNotification) => void }) {
  const m = META[n.type];
  const Icon = m.icon;
  const now = useNow(1000);
  const expires = n.data?.expiresAt ? new Date(n.data.expiresAt).getTime() - now.getTime() : null;
  const live = n.type === "slot_available" && expires !== null && expires > 0;
  return (
    <li>
      <button onClick={() => onOpen(n)} className={cn("group flex w-full gap-3 rounded-2xl p-3 text-start transition-colors hover:bg-surface-2", !n.readAt && "bg-brand-softer")}>
        <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", m.tone)}>
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className={cn("text-sm leading-snug", n.readAt ? "font-medium text-ink-2" : "font-bold text-ink")}>{n.title}</span>
            {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-label={t("Unread")} />}
          </span>
          <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{n.body}</span>
          <span className="mt-1.5 flex items-center gap-2 text-xs text-faint">
            {fmtAgo(n.createdAt, now)}
            {live && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-brand-strong tabular">
                <Clock className="size-3" /> {countdown(expires!)}{" "}{t("left to claim")}
              </span>
            )}
            {n.type === "slot_available" && expires !== null && expires <= 0 && <span className="font-semibold">{t("Offer ended")}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

export function NotificationList({ onNavigate, compact }: { onNavigate?: () => void; compact?: boolean }) {
  const q = useNotifications();
  const nav = useNavigate();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const mark = useMutation({ mutationFn: (ids: string[] | "all") => api.me.markRead(ids) });
  const open = (n: AppNotification) => {
    if (!n.readAt) mark.mutate([n.id]);
    if (n.link) {
      onNavigate?.();
      nav(n.link);
    }
  };
  if (q.isPending)
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex gap-3 p-2">
            <Skeleton className="size-9 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  const all = q.data ?? [];
  const list = filter === "unread" ? all.filter((n) => !n.readAt) : all;
  const unread = all.filter((n) => !n.readAt).length;
  const today = list.filter((n) => isToday(new Date(n.createdAt)));
  const earlier = list.filter((n) => !isToday(new Date(n.createdAt)));
  return (
    <div>
      <div className={cn("flex items-center justify-between gap-2", compact ? "px-3 pb-2" : "mb-3")}>
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {(["all", "unread"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn("h-7 rounded-lg px-3 text-xs font-semibold capitalize transition-colors", filter === f ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
              {f}
              {f === "unread" && unread > 0 && ` (${unread})`}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="xs" disabled={!unread || mark.isPending} onClick={() => mark.mutate("all")}>
          {t("Mark all as read")}
        </Button>
      </div>
      {list.length === 0 ? (
        <EmptyState compact icon={BellOff} title={filter === "unread" ? t("You’re all caught up") : t("No notifications yet")} body={t("Booking confirmations, reminders and waitlist offers will appear here.")} />
      ) : (
        <div className="space-y-4">
          {[
            [t("Today"), today],
            [t("Earlier"), earlier],
          ].map(([label, items]) =>
            (items as AppNotification[]).length ? (
              <section key={label as string}>
                <h3 className={cn("mb-1 text-xs font-bold uppercase tracking-wider text-faint", compact ? "px-3" : "px-1")}>{label as string}</h3>
                <ul className="space-y-0.5">
                  <AnimatePresence initial={false}>
                    {(items as AppNotification[]).map((n) => (
                      <motion.div key={n.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <Item n={n} onOpen={open} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

/** Bell with unread badge. Desktop opens a popover; phones go to the full page. */
export function NotificationBell({ tone = "default", mobilePath = "/notifications" }: { tone?: "default" | "light"; mobilePath?: string | null }) {
  const q = useNotifications();
  const unread = (q.data ?? []).filter((n) => !n.readAt).length;
  const desktop = useIsDesktop();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <IconButton
        label={unread ? t("Notifications, {n} unread", { n: unread }) : t("Notifications")}
        variant={tone === "light" ? "ghost" : "ghost"}
        className={tone === "light" ? "text-on-dusk hover:bg-white/10 hover:text-white" : undefined}
        onClick={() => (desktop || !mobilePath ? setOpen((o) => !o) : nav(mobilePath))}
        aria-expanded={open}
      >
        <motion.span key={unread} initial={unread ? { rotate: -18 } : false} animate={{ rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 8 }}>
          <Bell className="size-5" />
        </motion.span>
        <AnimatePresence>
          {unread > 0 && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute end-1 top-1 flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[18px] text-white ring-2 ring-bg">
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </IconButton>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute end-0 top-full z-[70] mt-2 w-[min(420px,calc(100vw-24px))] origin-top-right rounded-3xl border border-line bg-surface py-3 shadow-lg"
          >
            <div className="flex items-center justify-between px-4 pb-2">
              <h2 className="text-base font-bold text-ink">{t("Notifications")}</h2>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-1">
              <NotificationList compact onNavigate={() => setOpen(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
