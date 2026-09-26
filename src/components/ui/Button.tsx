import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";
import { t } from "@/i18n";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "soft" | "dusk" | "danger-soft";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover shadow-[0_1px_0_rgb(255_255_255/0.15)_inset,0_1px_2px_rgb(0_0_0/0.12)]",
  secondary: "bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2 shadow-sm",
  outline: "border border-line-strong text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  soft: "bg-brand-soft text-brand-strong hover:bg-brand-soft/70 dark:text-brand-strong",
  danger: "bg-danger text-white hover:brightness-110 dark:text-[#1b0d0b]",
  "danger-soft": "bg-danger-soft text-danger hover:brightness-95",
  dusk: "bg-dusk text-on-dusk hover:bg-dusk-2",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-xs gap-1.5 rounded-lg",
  sm: "h-9 px-3 text-[13px] gap-1.5 rounded-[10px]",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-5 text-[15px] gap-2 rounded-2xl",
  xl: "h-14 px-6 text-base gap-2.5 rounded-2xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  success?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, success, icon, iconRight, block, className, children, disabled, ...rest },
  ref,
) {
  const state = success ? "success" : loading ? "loading" : "idle";
  return (
    <button
      ref={ref}
      className={cn(
        "relative inline-flex select-none items-center justify-center font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform,filter] duration-150 ease-out active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100",
        variants[variant],
        sizes[size],
        block && "w-full",
        success && variant === "primary" && "bg-success! text-white!",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {state === "idle" && (
          <motion.span key="idle" className="inline-flex items-center gap-[inherit]" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
            {icon}
            {children}
            {iconRight}
          </motion.span>
        )}
        {state === "loading" && (
          <motion.span key="loading" className="inline-flex items-center gap-2" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            <Spinner className="size-4" />
            <span className="sr-only">{t("Working…")}</span>
            {size !== "xs" && size !== "sm" && <span aria-hidden>{children}</span>}
          </motion.span>
        )}
        {state === "success" && (
          <motion.span key="success" className="inline-flex items-center gap-2" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 28 }}>
            <Check className="size-4" strokeWidth={3} />
            {t("Done")}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: "ghost" | "secondary" | "glass" | "soft"; size?: "sm" | "md" | "lg" }>(function IconButton(
  { label, variant = "ghost", size = "md", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 active:scale-90 disabled:opacity-40",
        size === "sm" ? "size-8" : size === "lg" ? "size-12" : "size-10",
        variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
        variant === "secondary" && "border border-line bg-surface text-ink shadow-sm hover:bg-surface-2",
        variant === "glass" && "glass text-ink shadow-md hover:bg-surface",
        variant === "soft" && "bg-surface-2 text-ink hover:bg-surface-3",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
