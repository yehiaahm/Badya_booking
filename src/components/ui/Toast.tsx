import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { create } from "zustand";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { t as tr } from "@/i18n";

type ToastTone = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
  duration: number;
}

interface ToastState {
  items: ToastItem[];
  push: (t: Omit<ToastItem, "id" | "duration"> & { duration?: number }) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (t) => set((s) => ({ items: [...s.items.slice(-2), { duration: 4200, ...t, id: ++seq }] })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (title: string, body?: string, action?: ToastItem["action"]) => useToasts.getState().push({ tone: "success", title, body, action }),
  error: (title: string, body?: string) => useToasts.getState().push({ tone: "error", title, body, duration: 6000 }),
  info: (title: string, body?: string, action?: ToastItem["action"]) => useToasts.getState().push({ tone: "info", title, body, action }),
  warning: (title: string, body?: string) => useToasts.getState().push({ tone: "warning", title, body, duration: 6000 }),
};

const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const colors = { success: "text-success", error: "text-danger", info: "text-info", warning: "text-warning" };

function ToastView({ t }: { t: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    const id = setTimeout(() => dismiss(t.id), t.duration);
    return () => clearTimeout(id);
  }, [t, dismiss]);
  const Icon = icons[t.tone];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 460, damping: 34 }}
      role={t.tone === "error" ? "alert" : "status"}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 pe-2.5 shadow-lg"
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", colors[t.tone])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{t.title}</p>
        {t.body && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{t.body}</p>}
        {t.action && (
          <button
            className="mt-2 text-[13px] font-bold text-brand hover:underline"
            onClick={() => {
              t.action!.onClick();
              dismiss(t.id);
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button aria-label={tr("Dismiss notification")} onClick={() => dismiss(t.id)} className="rounded-full p-1 text-faint hover:bg-surface-2 hover:text-ink">
        <X className="size-4" />
      </button>
    </motion.div>
  );
}

export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:start-auto sm:end-6 sm:w-[380px] sm:items-end sm:px-0 lg:bottom-6">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <ToastView key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
