import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFocusTrap, useIsMobile, useScrollLock } from "@/lib/hooks";
import { IconButton } from "./Button";
import { t } from "@/i18n";

interface BaseProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Hide the default header (render your own). */
  bare?: boolean;
  className?: string;
  dismissible?: boolean;
}

function useEscape(open: boolean, onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!open || !enabled) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose, enabled]);
}

const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
/** Drawers sit on the end side, so they slide in from the right in English and the left in Arabic. */
const offscreen = () => (document.documentElement.dir === "rtl" ? "-100%" : "100%");

function Header({ title, description, onClose, id, dismissible }: { title?: ReactNode; description?: ReactNode; onClose: () => void; id: string; dismissible: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
      <div className="min-w-0">
        {title && (
          <h2 id={id} className="text-lg font-bold tracking-tight text-ink">
            {title}
          </h2>
        )}
        {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {dismissible && (
        <IconButton label={t("Close")} size="sm" variant="soft" onClick={onClose} className="-me-1">
          <X className="size-4" />
        </IconButton>
      )}
    </div>
  );
}

/** Centered modal dialog. */
export function Dialog({ open, onClose, title, description, children, footer, size = "md", bare, className, dismissible = true }: BaseProps) {
  const id = useId();
  const ref = useFocusTrap(open);
  useScrollLock(open);
  useEscape(open, onClose, dismissible);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div className="absolute inset-0 bg-[rgb(12_16_24/0.45)] backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={dismissible ? onClose : undefined} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? id : undefined}
            tabIndex={-1}
            className={cn("relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-line bg-surface shadow-lg outline-none sm:rounded-[24px]", widths[size], className)}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
          >
            {!bare && <Header title={title} description={description} onClose={onClose} id={id} dismissible={dismissible} />}
            <div className={cn("min-h-0 flex-1 overflow-y-auto", !bare && "px-6 pb-5")}>{children}</div>
            {footer && <div className="flex flex-col-reverse gap-2 border-t border-line bg-bg-elevated px-6 py-4 pb-safe sm:flex-row sm:justify-end">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Bottom sheet on phones, dialog on larger screens. */
export function Sheet(props: BaseProps) {
  const mobile = useIsMobile();
  if (!mobile) return <Dialog {...props} />;
  return <BottomSheet {...props} />;
}

function BottomSheet({ open, onClose, title, description, children, footer, bare, className, dismissible = true }: BaseProps) {
  const id = useId();
  const ref = useFocusTrap(open);
  const drag = useDragControls();
  useScrollLock(open);
  useEscape(open, onClose, dismissible);
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (dismissible && (info.offset.y > 120 || info.velocity.y > 600)) onClose();
  };
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end">
          <motion.div className="absolute inset-0 bg-[rgb(12_16_24/0.45)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={dismissible ? onClose : undefined} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? id : undefined}
            tabIndex={-1}
            className={cn("relative flex max-h-[94dvh] w-full flex-col rounded-t-[28px] border-t border-line bg-surface shadow-lg outline-none", className)}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
          >
            <div className="flex cursor-grab touch-none justify-center pt-2.5 pb-1 active:cursor-grabbing" onPointerDown={(e) => drag.start(e)}>
              <span className="h-1.5 w-10 rounded-full bg-line-strong" />
            </div>
            {!bare && <Header title={title} description={description} onClose={onClose} id={id} dismissible={dismissible} />}
            <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", !bare && "px-5 pb-4")}>{children}</div>
            {footer && <div className="flex flex-col gap-2 border-t border-line bg-bg-elevated px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Side panel — used for details in admin tables. */
export function Drawer({ open, onClose, title, description, children, footer, size = "md", className }: BaseProps) {
  const id = useId();
  const ref = useFocusTrap(open);
  useScrollLock(open);
  useEscape(open, onClose);
  const w = size === "lg" || size === "xl" ? "sm:max-w-2xl" : "sm:max-w-lg";
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex justify-end">
          <motion.div className="absolute inset-0 bg-[rgb(12_16_24/0.35)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={id}
            tabIndex={-1}
            className={cn("relative flex h-full w-full flex-col border-s border-line bg-surface shadow-lg outline-none", w, className)}
            initial={{ x: offscreen() }}
            animate={{ x: 0 }}
            exit={{ x: offscreen() }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
          >
            <div className="border-b border-line">
              <Header title={title} description={description} onClose={onClose} id={id} dismissible />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-bg-elevated px-6 py-4">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
