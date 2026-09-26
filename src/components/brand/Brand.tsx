import { cn } from "@/lib/cn";
import { t } from "@/i18n";

const base = import.meta.env.BASE_URL;
export const BRAND_ASSETS = {
  mark: `${base}brand/badya-mark.png`,
  logo: `${base}brand/badya-logo.png`,
  campus: `${base}brand/campus-aerial.jpg`,
};

/**
 * The Badya University mark, recoloured with CSS so it works on any surface
 * and in dark mode. Replace /public/brand assets with official files.
 */
export function BrandMark({ className, size = 28, title = t("Badya University") }: { className?: string; size?: number; title?: string }) {
  return (
    <span
      role="img"
      aria-label={title}
      className={cn("inline-block shrink-0 bg-current text-brand", className)}
      style={{
        width: size * (327 / 300),
        height: size,
        WebkitMaskImage: `url(${BRAND_ASSETS.mark})`,
        maskImage: `url(${BRAND_ASSETS.mark})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

export function BrandLockup({ className, compact, tone = "default", product = "Spaces" }: { className?: string; compact?: boolean; tone?: "default" | "light"; product?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark size={compact ? 24 : 30} className={tone === "light" ? "text-[#d9ae8a]" : undefined} />
      <span className="flex flex-col leading-none">
        <span className={cn("font-display text-[21px] tracking-tight", tone === "light" ? "text-white" : "text-ink")}>
          {t("Badya")}{" "}<span className="italic text-brand">{product}</span>
        </span>
        {!compact && <span className={cn("mt-1 text-[10px] font-semibold uppercase tracking-[0.22em]", tone === "light" ? "text-white/60" : "text-muted")}>{t("Badya University")}</span>}
      </span>
    </span>
  );
}
