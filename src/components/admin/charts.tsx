"use client";

/**
 * Small, dependency-free SVG charts for the admin dashboard.
 * Spec: bars ≤24px with 4px rounded data-ends and a 2px gap, hairline solid gridlines,
 * clean y ticks, tooltip on hover/focus, values never encoded by colour alone.
 * Colours were validated for the #181818 surface (dataviz validate_palette.js):
 * series-1 #1aa34a (on-brand green, inside the lightness band), series-2 #3987e5.
 */
import { useLayoutEffect, useRef, useState } from "react";

export const SERIES_1 = "#1aa34a";
export const SERIES_2 = "#3987e5";
const GRID = "#2c2c2a";
const AXIS = "#383835";
const MUTED = "#898781";

/** Clean axis maximum and tick step; counts never get fractional ticks. */
function niceMax(v: number, integer = true): { max: number; step: number } {
  if (v <= 0) return { max: 4, step: 1 };
  const raw = v / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  if (integer) step = Math.max(1, Math.round(step));
  return { max: step * Math.ceil(v / step), step };
}

const fmtTick = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n.toLocaleString("en-US"));

export interface ColumnDatum {
  label: string;
  value: number;
  detail?: { k: string; v: string }[];
}

export function ColumnChart({ data, height = 180, ariaLabel, xEvery = 1, unit = "" }: { data: ColumnDatum[]; height?: number; ariaLabel: string; xEvery?: number; unit?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Measured from the container before the first paint. The SVG is only drawn once the width is
  // known, so it never props its container open at a guessed width (which on phones kept the
  // chart wider than the screen).
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (width: number) => setW(Math.max(200, Math.floor(width)));
    measure(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => measure(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const padL = 36;
  const padB = 22;
  const padT = 8;
  const innerW = w - padL - 4;
  const innerH = height - padB - padT;
  const { max, step } = niceMax(Math.max(...data.map((d) => d.value), 0));
  const band = innerW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const hv = hover != null ? data[hover] : null;

  return (
    <div ref={ref} className="relative min-w-0" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - 4} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={MUTED} className="tabular-nums">
                {fmtTick(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = padL + i * band + (band - barW) / 2;
            const top = y(d.value);
            const h = Math.max(0, padT + innerH - top);
            const r = Math.min(4, h, barW / 2);
            const path = h > 0 ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z` : "";
            return (
              <g key={i}>
                {path && <path d={path} fill={SERIES_1} opacity={hover == null || hover === i ? 1 : 0.55} />}
                <rect
                  x={padL + i * band}
                  y={padT}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.label}: ${d.value.toLocaleString()}${unit}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                />
                {i % xEvery === 0 && (
                  <text x={padL + i * band + band / 2} y={height - 6} textAnchor="middle" fontSize={10} fill={MUTED}>
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hv && hover != null && (
        <div
          className="pointer-events-none absolute z-10 min-w-[120px] rounded-md bg-[#2a2a2a] px-3 py-2 text-xs shadow-float"
          style={{ left: Math.min(w - 140, Math.max(0, padL + hover * band + band / 2 - 60)), top: 0 }}
          role="status"
        >
          <div className="text-sm font-bold text-white">
            {hv.value.toLocaleString()}
            {unit}
          </div>
          <div className="text-subdued">{hv.label}</div>
          {hv.detail?.map((r) => (
            <div key={r.k} className="mt-0.5 flex justify-between gap-3 text-subdued">
              <span>{r.k}</span>
              <span className="font-semibold text-white">{r.v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Meter({ value, max, color = SERIES_1, label }: { value: number; max: number; color?: string; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${color} 22%, #181818)` }} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-card p-4">
      <div className="text-xs font-semibold text-subdued">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function RankList({ rows, unit = "plays" }: { rows: { key: string; label: React.ReactNode; sub?: React.ReactNode; value: number; lead?: React.ReactNode }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-sm text-subdued">No plays in this period yet.</p>;
  return (
    <ol className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.key} className="flex items-center gap-3">
          <span className="w-4 text-right text-xs tabular-nums text-muted">{i + 1}</span>
          {r.lead}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold">{r.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-subdued">
                {r.value.toLocaleString()} {unit}
              </span>
            </div>
            {r.sub && <div className="truncate text-xs text-subdued">{r.sub}</div>}
            <div className="mt-1">
              <Meter value={r.value} max={max} label={`${r.value} ${unit}`} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
