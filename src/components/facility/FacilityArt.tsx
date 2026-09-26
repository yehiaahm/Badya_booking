import { memo, useId, type ReactNode } from "react";
import type { Motif } from "@/domain/types";
import { cn } from "@/lib/cn";
import { t } from "@/i18n";

/**
 * Plan-view cover art for facilities — the same top-down perspective as the
 * campus masterplan. Admins can replace it with a photo (media.imageUrl).
 */

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function mix(hex: string, target: number, amt: number) {
  const { r, g, b } = hexToRgb(hex);
  const m = (c: number) => Math.round(c + (target - c) * amt);
  return `rgb(${m(r)} ${m(g)} ${m(b)})`;
}

const L = "rgb(255 255 255 / 0.66)";
const L2 = "rgb(255 255 255 / 0.3)";
const F = "rgb(255 255 255 / 0.08)";
const F2 = "rgb(255 255 255 / 0.14)";

const line = { stroke: L, strokeWidth: 1.6, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const thin = { stroke: L2, strokeWidth: 1.2, fill: "none", strokeLinecap: "round" as const };

function Football() {
  return (
    <g>
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={40 + i * 40} y={30} width={40} height={200} fill={i % 2 ? F : "transparent"} />
      ))}
      <rect x={40} y={30} width={320} height={200} {...line} />
      <line x1={200} y1={30} x2={200} y2={230} {...line} />
      <circle cx={200} cy={130} r={28} {...line} />
      <circle cx={200} cy={130} r={2.2} fill={L} />
      {[0, 1].map((s) => {
        const x = s ? 360 : 40;
        const d = s ? -1 : 1;
        return (
          <g key={s}>
            <rect x={s ? 308 : 40} y={78} width={52} height={104} {...line} />
            <rect x={s ? 338 : 40} y={105} width={22} height={50} {...line} />
            <circle cx={x + d * 38} cy={130} r={2} fill={L} />
            <path d={`M ${x + d * 52} 112 A 22 22 0 0 ${s ? 0 : 1} ${x + d * 52} 148`} {...line} />
            <rect x={s ? 360 : 32} y={116} width={8} height={28} {...thin} />
            <path d={`M ${x} 36 A 6 6 0 0 ${s ? 0 : 1} ${x + d * 6} 30`} {...thin} />
            <path d={`M ${x} 224 A 6 6 0 0 ${s ? 1 : 0} ${x + d * 6} 230`} {...thin} />
          </g>
        );
      })}
    </g>
  );
}

function Basketball() {
  return (
    <g>
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1={40} x2={360} y1={40 + i * 16} y2={40 + i * 16} stroke="rgb(255 255 255 / 0.06)" />
      ))}
      <rect x={40} y={40} width={320} height={180} {...line} />
      <line x1={200} y1={40} x2={200} y2={220} {...line} />
      <circle cx={200} cy={130} r={24} {...line} />
      <circle cx={200} cy={130} r={8} {...thin} />
      {[0, 1].map((s) => {
        const x = s ? 360 : 40;
        const d = s ? -1 : 1;
        return (
          <g key={s}>
            <rect x={s ? 290 : 40} y={104} width={70} height={52} {...line} fill={F} />
            <circle cx={x + d * 70} cy={130} r={26} {...thin} strokeDasharray="4 5" />
            <path d={`M ${x} 56 H ${x + d * 30} A 96 96 0 0 ${s ? 0 : 1} ${x + d * 30} 204 H ${x}`} {...line} />
            <line x1={x + d * 12} y1={118} x2={x + d * 12} y2={142} stroke={L} strokeWidth={2.4} />
            <circle cx={x + d * 18} cy={130} r={5} {...line} />
          </g>
        );
      })}
    </g>
  );
}

function Tennis() {
  // One court, drawn to scale: 23.77 × 10.97 m with doubles alleys and service boxes.
  const x0 = 48, x1 = 352, y0 = 60, y1 = 200;
  const alley = (y1 - y0) * 0.125;
  const service = ((x1 - x0) / 23.77) * 6.4;
  return (
    <g>
      <rect x={26} y={34} width={348} height={192} rx={6} {...thin} />
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} {...line} fill={F} />
      <line x1={x0} y1={y0 + alley} x2={x1} y2={y0 + alley} {...line} />
      <line x1={x0} y1={y1 - alley} x2={x1} y2={y1 - alley} {...line} />
      <line x1={200 - service} y1={y0 + alley} x2={200 - service} y2={y1 - alley} {...line} />
      <line x1={200 + service} y1={y0 + alley} x2={200 + service} y2={y1 - alley} {...line} />
      <line x1={200 - service} y1={130} x2={200 + service} y2={130} {...line} />
      <line x1={x0} y1={130} x2={x0 + 7} y2={130} {...line} />
      <line x1={x1 - 7} y1={130} x2={x1} y2={130} {...line} />
      <line x1={200} y1={y0 - 8} x2={200} y2={y1 + 8} stroke={L} strokeWidth={2.6} strokeDasharray="1 3" />
    </g>
  );
}

function Padel() {
  return (
    <g>
      {[0, 1].map((i) => {
        const x = 52 + i * 160;
        return (
          <g key={i}>
            <rect x={x - 6} y={20} width={148} height={220} rx={3} {...thin} />
            <rect x={x} y={26} width={136} height={208} {...line} fill={F} />
            <line x1={x} y1={130} x2={x + 136} y2={130} stroke={L} strokeWidth={2.6} strokeDasharray="1 3" />
            <line x1={x} y1={72} x2={x + 136} y2={72} {...line} />
            <line x1={x} y1={188} x2={x + 136} y2={188} {...line} />
            <line x1={x + 68} y1={72} x2={x + 68} y2={188} {...line} />
            {[26, 234].map((yy) => (
              <g key={yy}>
                <line x1={x} y1={yy} x2={x + 36} y2={yy} stroke={L} strokeWidth={3.5} />
                <line x1={x + 100} y1={yy} x2={x + 136} y2={yy} stroke={L} strokeWidth={3.5} />
              </g>
            ))}
          </g>
        );
      })}
    </g>
  );
}

function Pool() {
  const lanes = 8;
  const top = 44;
  const h = 172;
  const lh = h / lanes;
  return (
    <g>
      <rect x={30} y={top} width={340} height={h} rx={4} {...line} fill={F} />
      {Array.from({ length: lanes - 1 }, (_, i) => (
        <line key={i} x1={30} x2={370} y1={top + lh * (i + 1)} y2={top + lh * (i + 1)} stroke={L} strokeWidth={1.8} strokeDasharray="2 5" strokeLinecap="round" />
      ))}
      {Array.from({ length: lanes }, (_, i) => {
        const cy = top + lh * i + lh / 2;
        return (
          <g key={i}>
            <line x1={52} x2={348} y1={cy} y2={cy} stroke={L2} strokeWidth={2.2} />
            <line x1={52} x2={52} y1={cy - 5} y2={cy + 5} stroke={L2} strokeWidth={2.2} />
            <line x1={348} x2={348} y1={cy - 5} y2={cy + 5} stroke={L2} strokeWidth={2.2} />
            <rect x={22} y={cy - 5} width={8} height={10} rx={1.5} fill={L2} />
          </g>
        );
      })}
      {[70, 150, 230].map((y, i) => (
        <path key={i} d={`M ${90 + i * 60} ${y} q 12 -6 24 0 t 24 0 t 24 0`} stroke="rgb(255 255 255 / 0.22)" strokeWidth={1.4} fill="none" />
      ))}
    </g>
  );
}

function Gym() {
  return (
    <g>
      <rect x={24} y={24} width={352} height={212} rx={6} {...thin} />
      {[0, 1].map((r) =>
        Array.from({ length: 5 }, (_, i) => (
          <g key={`${r}${i}`}>
            <rect x={44 + i * 34} y={44 + r * 44} width={24} height={34} rx={5} {...line} fill={F} />
            <rect x={49 + i * 34} y={49 + r * 44} width={14} height={5} rx={1.5} fill={L2} />
          </g>
        )),
      )}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={232 + i * 46} y={44} width={34} height={56} {...line} />
          <line x1={226 + i * 46} x2={272 + i * 46} y1={72} y2={72} stroke={L} strokeWidth={2.6} />
          <circle cx={226 + i * 46} cy={72} r={4} fill={L2} />
          <circle cx={272 + i * 46} cy={72} r={4} fill={L2} />
        </g>
      ))}
      <rect x={44} y={146} width={150} height={70} rx={6} fill={F} stroke={L2} strokeDasharray="4 5" />
      {Array.from({ length: 6 }, (_, i) => (
        <g key={i}>
          <line x1={236 + (i % 3) * 44} x2={262 + (i % 3) * 44} y1={150 + Math.floor(i / 3) * 34} y2={150 + Math.floor(i / 3) * 34} stroke={L} strokeWidth={2.2} />
          <rect x={231 + (i % 3) * 44} y={144 + Math.floor(i / 3) * 34} width={7} height={12} rx={2} fill={L} />
          <rect x={260 + (i % 3) * 44} y={144 + Math.floor(i / 3) * 34} width={7} height={12} rx={2} fill={L} />
        </g>
      ))}
      <circle cx={119} cy={181} r={16} {...thin} />
    </g>
  );
}

function Chairs({ cx, cy, rx, ry, n }: { cx: number; cy: number; rx: number; ry: number; n: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return <circle key={i} cx={cx + Math.cos(a) * rx} cy={cy + Math.sin(a) * ry} r={4.5} fill={F2} stroke={L2} />;
      })}
    </>
  );
}

function Study() {
  return (
    <g>
      {Array.from({ length: 6 }, (_, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = 30 + col * 116;
        const y = 28 + row * 106;
        return (
          <g key={i}>
            <path d={`M ${x + 40} ${y} H ${x} V ${y + 96} H ${x + 108} V ${y} H ${x + 64}`} {...line} />
            <path d={`M ${x + 40} ${y} A 24 24 0 0 1 ${x + 64} ${y + 22}`} {...thin} strokeDasharray="2 3" />
            <ellipse cx={x + 54} cy={y + 56} rx={26} ry={16} {...line} fill={F} />
            <Chairs cx={x + 54} cy={y + 56} rx={36} ry={25} n={6} />
            <line x1={x + 100} y1={y + 30} x2={x + 100} y2={y + 80} stroke={L} strokeWidth={2.4} />
          </g>
        );
      })}
    </g>
  );
}

function Pods() {
  return (
    <g>
      {Array.from({ length: 12 }, (_, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const x = 34 + col * 86;
        const y = 26 + row * 72;
        return (
          <g key={i}>
            <rect x={x} y={y} width={74} height={62} rx={14} {...line} fill={F} />
            <rect x={x + 10} y={y + 10} width={54} height={12} rx={3} {...thin} />
            <circle cx={x + 37} cy={y + 38} r={6} fill={F2} stroke={L2} />
            <line x1={x + 26} y1={y + 62} x2={x + 48} y2={y + 62} stroke="rgb(0 0 0 / 0.25)" strokeWidth={3} />
          </g>
        );
      })}
    </g>
  );
}

function Meeting() {
  return (
    <g>
      <rect x={30} y={30} width={340} height={200} rx={4} {...line} />
      <line x1={362} y1={80} x2={362} y2={180} stroke={L} strokeWidth={4} strokeLinecap="round" />
      <rect x={82} y={104} width={228} height={52} rx={26} {...line} fill={F} />
      {Array.from({ length: 6 }, (_, i) => (
        <g key={i}>
          <rect x={98 + i * 34} y={82} width={20} height={14} rx={5} fill={F2} stroke={L2} />
          <rect x={98 + i * 34} y={164} width={20} height={14} rx={5} fill={F2} stroke={L2} />
        </g>
      ))}
      <rect x={58} y={120} width={14} height={20} rx={5} fill={F2} stroke={L2} />
      <rect x={320} y={120} width={14} height={20} rx={5} fill={F2} stroke={L2} />
      <circle cx={196} cy={130} r={6} {...thin} />
    </g>
  );
}

function Studio() {
  return (
    <g>
      <rect x={30} y={26} width={340} height={208} rx={4} {...line} />
      {Array.from({ length: 16 }, (_, i) => (
        <rect key={i} x={40 + i * 20.5} y={32} width={12} height={16} rx={2} fill={i % 2 ? F2 : F} />
      ))}
      <circle cx={200} cy={136} r={46} {...line} fill={F} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const x = 200 + Math.cos(a) * 36;
        const y = 136 + Math.sin(a) * 36;
        const ox = 200 + Math.cos(a) * 64;
        const oy = 136 + Math.sin(a) * 64;
        return (
          <g key={i}>
            <line x1={x} y1={y} x2={ox} y2={oy} {...thin} />
            <circle cx={x} cy={y} r={6} fill={L} />
            <circle cx={ox} cy={oy} r={7} fill={F2} stroke={L2} />
          </g>
        );
      })}
      <rect x={290} y={180} width={64} height={38} rx={4} {...line} />
      {Array.from({ length: 6 }, (_, i) => (
        <line key={i} x1={298 + i * 9.5} x2={298 + i * 9.5} y1={188} y2={210} stroke={L2} strokeWidth={2} />
      ))}
      <path d="M 50 200 q 10 -12 20 0 t 20 0 t 20 0" {...thin} />
    </g>
  );
}

function Lab() {
  return (
    <g>
      <rect x={24} y={24} width={352} height={212} rx={4} {...thin} />
      {[0, 1, 2].map((r) => (
        <g key={r}>
          <rect x={48} y={52 + r * 58} width={210} height={26} rx={4} {...line} fill={F} />
          {Array.from({ length: 5 }, (_, i) => (
            <g key={i}>
              <rect x={56 + i * 41} y={57 + r * 58} width={28} height={16} rx={2} {...thin} />
              <circle cx={70 + i * 41} cy={90 + r * 58} r={4.5} fill={F2} stroke={L2} />
            </g>
          ))}
        </g>
      ))}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={288} y={44 + i * 56} width={64} height={42} rx={4} {...line} />
          <circle cx={320} cy={65 + i * 56} r={11} {...thin} />
          <line x1={309} y1={65 + i * 56} x2={331} y2={65 + i * 56} {...thin} />
        </g>
      ))}
    </g>
  );
}

function Computer() {
  return (
    <g>
      {Array.from({ length: 4 }, (_, r) => (
        <g key={r}>
          <rect x={40} y={38 + r * 50} width={320} height={16} rx={3} {...line} fill={F} />
          {Array.from({ length: 6 }, (_, i) => (
            <g key={i}>
              <rect x={52 + i * 52} y={40 + r * 50} width={30} height={5} rx={1.5} fill={L} />
              <circle cx={67 + i * 52} cy={65 + r * 50} r={5} fill={F2} stroke={L2} />
            </g>
          ))}
        </g>
      ))}
    </g>
  );
}

function Gaming() {
  return (
    <g>
      <rect x={24} y={24} width={352} height={212} rx={6} {...thin} />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={46 + i * 84} y={36} width={60} height={8} rx={2} fill={L} />
          <path d={`M ${42 + i * 84} 118 v -32 a 8 8 0 0 1 8 -8 h 52 a 8 8 0 0 1 8 8 v 32`} {...line} fill={F} />
          <rect x={58 + i * 84} y={94} width={36} height={16} rx={4} {...thin} />
        </g>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={46 + i * 84} y={150} width={60} height={34} rx={5} {...line} />
          <rect x={60 + i * 84} y={155} width={32} height={4} rx={1} fill={L} />
          <circle cx={76 + i * 84} cy={206} r={8} fill={F2} stroke={L2} />
        </g>
      ))}
      <path d="M 180 128 h 40" stroke="rgb(255 255 255 / 0.5)" strokeWidth={2} strokeDasharray="1 5" strokeLinecap="round" />
    </g>
  );
}

function Music() {
  return (
    <g>
      <rect x={30} y={30} width={160} height={200} rx={4} {...line} />
      <rect x={210} y={30} width={160} height={200} rx={4} {...line} />
      <rect x={52} y={60} width={116} height={42} rx={3} {...line} fill={F} />
      {Array.from({ length: 14 }, (_, i) => (
        <line key={i} x1={56 + i * 8} x2={56 + i * 8} y1={84} y2={102} stroke={L2} />
      ))}
      <circle cx={110} cy={130} r={7} fill={F2} stroke={L2} />
      <circle cx={290} cy={130} r={22} {...line} fill={F} />
      <circle cx={256} cy={104} r={13} {...line} />
      <circle cx={324} cy={104} r={13} {...line} />
      <circle cx={250} cy={150} r={15} {...line} />
      <circle cx={332} cy={152} r={16} {...line} />
      <rect x={228} y={188} width={36} height={26} rx={3} {...thin} />
      <rect x={316} y={188} width={36} height={26} rx={3} {...thin} />
      <path d="M 70 170 q 14 -14 28 0 t 28 0" {...thin} />
    </g>
  );
}

function TableTennis() {
  return (
    <g>
      {[0, 1, 2, 3].map((i) => {
        const x = 40 + (i % 2) * 170;
        const y = 34 + Math.floor(i / 2) * 104;
        return (
          <g key={i}>
            <rect x={x} y={y} width={150} height={84} rx={3} {...line} fill={F} />
            <line x1={x + 75} y1={y - 6} x2={x + 75} y2={y + 90} stroke={L} strokeWidth={2.6} />
            <line x1={x} y1={y + 42} x2={x + 150} y2={y + 42} {...thin} />
            <circle cx={x + 24} cy={y + 20} r={3} fill={L} />
          </g>
        );
      })}
    </g>
  );
}

function Volleyball() {
  // 18 × 9 m court with the net across the middle and 3 m attack lines.
  const x0 = 60, x1 = 340, y0 = 60, y1 = 200;
  const attack = ((x1 - x0) / 18) * 3;
  return (
    <g>
      <rect x={40} y={40} width={320} height={180} rx={6} {...thin} />
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} {...line} fill={F} />
      <line x1={200 - attack} y1={y0} x2={200 - attack} y2={y1} {...line} />
      <line x1={200 + attack} y1={y0} x2={200 + attack} y2={y1} {...line} />
      <line x1={200} y1={y0 - 12} x2={200} y2={y1 + 12} stroke={L} strokeWidth={3.2} strokeLinecap="round" />
      <circle cx={200} cy={y0 - 14} r={3.5} fill={L} />
      <circle cx={200} cy={y1 + 14} r={3.5} fill={L} />
      <circle cx={262} cy={104} r={9} {...line} />
      <path d="M 253 104 Q 262 96 271 104 M 262 95 Q 258 104 262 113" {...thin} />
    </g>
  );
}

function Billiards() {
  // Rail, cloth, six pockets, head string, a racked triangle and the cue ball.
  const x0 = 70, x1 = 330, y0 = 62, y1 = 198;
  const pockets: [number, number][] = [[x0 + 10, y0 + 10], [200, y0 + 6], [x1 - 10, y0 + 10], [x0 + 10, y1 - 10], [200, y1 - 6], [x1 - 10, y1 - 10]];
  const rack: [number, number][] = [];
  for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) rack.push([262 + row * 9, 130 - row * 5.2 + i * 10.4]);
  return (
    <g>
      <rect x={x0 - 12} y={y0 - 12} width={x1 - x0 + 24} height={y1 - y0 + 24} rx={14} {...line} fill={F2} />
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={3} {...line} fill={F} />
      {pockets.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={8} fill="rgb(0 0 0 / 0.28)" stroke={L} strokeWidth={1.4} />
      ))}
      <line x1={x0 + (x1 - x0) / 4} y1={y0} x2={x0 + (x1 - x0) / 4} y2={y1} {...thin} />
      {rack.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={4.6} fill={i === 4 ? L : F2} stroke={L} strokeWidth={1.1} />
      ))}
      <circle cx={x0 + (x1 - x0) / 4} cy={130} r={4.6} fill={L} />
      <line x1={40} y1={176} x2={x0 + (x1 - x0) / 4 - 10} y2={134} stroke={L} strokeWidth={2.4} strokeLinecap="round" />
    </g>
  );
}

function AirHockey() {
  // Table with centre line and circle, goal creases, air holes, two mallets and a puck.
  const x0 = 58, x1 = 342, y0 = 52, y1 = 208;
  const holes: [number, number][] = [];
  for (let i = 0; i < 13; i++) for (let j = 0; j < 6; j++) holes.push([x0 + 20 + i * 20.3, y0 + 18 + j * 24]);
  return (
    <g>
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={22} {...line} fill={F} />
      {holes.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={1.2} fill={F2} />
      ))}
      <line x1={200} y1={y0} x2={200} y2={y1} {...line} />
      <circle cx={200} cy={130} r={28} {...line} />
      {[0, 1].map((side) => {
        const x = side ? x1 : x0;
        const d = side ? -1 : 1;
        return (
          <g key={side}>
            <line x1={x} y1={106} x2={x} y2={154} stroke={L} strokeWidth={5} strokeLinecap="round" />
            <path d={`M ${x} 94 A 36 36 0 0 ${side ? 0 : 1} ${x} 166`} {...thin} />
            <circle cx={x + d * 58} cy={side ? 150 : 112} r={13} {...line} fill={F2} />
            <circle cx={x + d * 58} cy={side ? 150 : 112} r={5} fill={L} />
          </g>
        );
      })}
      <circle cx={228} cy={122} r={7} fill={L} />
    </g>
  );
}

function Generic() {
  return (
    <g>
      {Array.from({ length: 7 }, (_, i) => (
        <path key={i} d={`M ${30 + i * 52} 230 V 120 A 22 22 0 0 1 ${74 + i * 52} 120 V 230`} {...(i % 2 ? thin : line)} />
      ))}
      <line x1={20} y1={230} x2={380} y2={230} {...line} />
    </g>
  );
}

const MOTIFS: Record<Motif, () => ReactNode> = {
  football: Football,
  basketball: Basketball,
  tennis: Tennis,
  padel: Padel,
  pool: Pool,
  gym: Gym,
  study: Study,
  pods: Pods,
  meeting: Meeting,
  studio: Studio,
  lab: Lab,
  computer: Computer,
  gaming: Gaming,
  music: Music,
  tabletennis: TableTennis,
  volleyball: Volleyball,
  billiards: Billiards,
  airhockey: AirHockey,
  generic: Generic,
};

export const MOTIF_OPTIONS: { value: Motif; label: string }[] = [
  { value: "football", get label() {
    return t("Football pitch");
  } },
  { value: "basketball", get label() {
    return t("Basketball court");
  } },
  { value: "tennis", get label() {
    return t("Tennis courts");
  } },
  { value: "padel", get label() {
    return t("Padel courts");
  } },
  { value: "tabletennis", get label() {
    return t("Table tennis");
  } },
  { value: "volleyball", get label() {
    return t("Volleyball court");
  } },
  { value: "billiards", get label() {
    return t("Billiards table");
  } },
  { value: "airhockey", get label() {
    return t("Air hockey table");
  } },
  { value: "pool", get label() {
    return t("Swimming pool");
  } },
  { value: "gym", get label() {
    return t("Gym floor");
  } },
  { value: "study", get label() {
    return t("Study rooms");
  } },
  { value: "pods", get label() {
    return t("Study pods");
  } },
  { value: "meeting", get label() {
    return t("Meeting room");
  } },
  { value: "studio", get label() {
    return t("Media studio");
  } },
  { value: "lab", get label() {
    return t("Lab benches");
  } },
  { value: "computer", get label() {
    return t("Computer lab");
  } },
  { value: "gaming", get label() {
    return t("Gaming lounge");
  } },
  { value: "music", get label() {
    return t("Music room");
  } },
  { value: "generic", get label() {
    return t("Campus arches");
  } },
];

export const FacilityArt = memo(function FacilityArt({ motif, accent, imageUrl, className, alt, dim }: { motif: Motif; accent: string; imageUrl?: string; className?: string; alt?: string; dim?: boolean }) {
  const id = useId().replace(/:/g, "");
  if (imageUrl) {
    return (
      <div className={cn("relative overflow-hidden bg-surface-3", className)}>
        <img src={imageUrl} alt={alt ?? ""} className={cn("absolute inset-0 size-full object-cover", dim && "grayscale")} loading="lazy" />
      </div>
    );
  }
  const Art = MOTIFS[motif] ?? Generic;
  return (
    <div className={cn("relative overflow-hidden", className)} role={alt ? "img" : undefined} aria-label={alt} aria-hidden={alt ? undefined : true}>
      <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" className={cn("absolute inset-0 size-full", dim && "grayscale-[0.85]")}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={mix(accent, 255, 0.1)} />
            <stop offset="1" stopColor={mix(accent, 0, 0.42)} />
          </linearGradient>
          <radialGradient id={`r${id}`} cx="0.15" cy="0" r="0.9">
            <stop offset="0" stopColor="rgb(255 236 210 / 0.35)" />
            <stop offset="1" stopColor="rgb(255 236 210 / 0)" />
          </radialGradient>
          <radialGradient id={`v${id}`} cx="0.5" cy="0.5" r="0.75">
            <stop offset="0.6" stopColor="rgb(0 0 0 / 0)" />
            <stop offset="1" stopColor="rgb(0 0 0 / 0.28)" />
          </radialGradient>
        </defs>
        <rect width="400" height="260" fill={`url(#g${id})`} />
        <Art />
        <rect width="400" height="260" fill={`url(#r${id})`} />
        <rect width="400" height="260" fill={`url(#v${id})`} />
      </svg>
    </div>
  );
});
