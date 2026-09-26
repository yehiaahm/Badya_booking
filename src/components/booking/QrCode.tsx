import { memo, useMemo } from "react";
import QR from "qrcode";
import { BRAND_ASSETS } from "@/components/brand/Brand";
import { t } from "@/i18n";

/** Custom-rendered QR code: rounded modules, soft finder patterns, brand mark in the centre. */
export const QrCode = memo(function QrCode({ value, size = 220, color = "#1c1915", className }: { value: string; size?: number; color?: string; className?: string }) {
  const { n, cells } = useMemo(() => {
    const q = QR.create(value, { errorCorrectionLevel: "H" });
    const n = q.modules.size;
    const data = q.modules.data;
    const cells: [number, number][] = [];
    const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
    const c0 = n / 2 - n * 0.12;
    const c1 = n / 2 + n * 0.12;
    const inCenter = (x: number, y: number) => x >= c0 && x <= c1 && y >= c0 && y <= c1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (data[y * n + x] && !inFinder(x, y) && !inCenter(x, y)) cells.push([x, y]);
    return { n, cells };
  }, [value]);

  const pad = 2;
  const vb = n + pad * 2;
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x + pad + 0.5} y={y + pad + 0.5} width={6} height={6} rx={1.8} fill="none" stroke={color} strokeWidth={1} />
      <rect x={x + pad + 2} y={y + pad + 2} width={3} height={3} rx={0.9} fill={color} />
    </g>
  );
  const logo = n * 0.2;
  return (
    <svg viewBox={`0 0 ${vb} ${vb}`} width={size} height={size} className={className} role="img" aria-label={t("Booking QR code")}>
      <rect width={vb} height={vb} fill="#fff" rx={2} />
      {cells.map(([x, y]) => (
        <rect key={`${x}.${y}`} x={x + pad + 0.08} y={y + pad + 0.08} width={0.84} height={0.84} rx={0.3} fill={color} />
      ))}
      {finder(0, 0)}
      {finder(n - 7, 0)}
      {finder(0, n - 7)}
      <rect x={vb / 2 - logo / 2 - 0.6} y={vb / 2 - logo / 2 - 0.6} width={logo + 1.2} height={logo + 1.2} rx={logo * 0.28} fill="#fff" />
      <image href={BRAND_ASSETS.mark} x={vb / 2 - logo / 2 + logo * 0.08} y={vb / 2 - logo / 2 + logo * 0.1} width={logo * 0.84} height={logo * 0.8} preserveAspectRatio="xMidYMid meet" />
    </svg>
  );
});
