'use client';

import type { LoadChart as LoadChartData, LoadSeries } from '@pulsegrid/shared';
import { TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Time } from '@/components/ui/time';
import { chartCeiling, chartTimestamps, formatLoadValue, formatReading, isNearLimit, latestValue, valueAt } from '@/lib/load';

const WIDTH = 400;
const HEIGHT = 120;
const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

interface Scale {
  x: (timestamp: string) => number;
  y: (value: number) => number;
}

const scaleFor = (timestamps: readonly string[], ceiling: number): Scale => {
  const first = Date.parse(timestamps[0] ?? '');
  const span = Math.max(1, Date.parse(timestamps.at(-1) ?? '') - first);
  return {
    x: (timestamp) => (Date.parse(timestamp) - first) / span,
    y: (value) => 1 - Math.min(value, ceiling) / ceiling,
  };
};

const pathOf = ({ points }: LoadSeries, scale: Scale): string =>
  points
    .map(({ timestamp, value }, index) =>
      `${index === 0 ? 'M' : 'L'}${(scale.x(timestamp) * WIDTH).toFixed(1)},${(scale.y(value) * HEIGHT).toFixed(1)}`,
    )
    .join(' ');

const percent = (ratio: number): string => `${(ratio * 100).toFixed(2)}%`;

function Swatch({ index }: { index: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-0.5 w-3 shrink-0 rounded-full"
      style={{ background: SERIES_COLORS[index] }}
    />
  );
}

function Legend({ chart }: { chart: LoadChartData }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {chart.series.map((series, index) => {
        const latest = latestValue(series);
        return (
          <li className="flex items-center gap-1.5" key={series.label}>
            <Swatch index={index} />
            <span>{series.label}</span>
            <span className="font-medium text-foreground">
              {latest === null ? '—' : formatReading(latest, chart)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Tooltip({ chart, timestamp, x }: { chart: LoadChartData; timestamp: string; x: number }) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border bg-card px-3 py-2 text-xs shadow-md"
      style={x > 0.6 ? { right: `calc(${percent(1 - x)} + 8px)` } : { left: `calc(${percent(x)} + 8px)` }}
    >
      <p className="mb-1 text-muted-foreground">
        <Time value={timestamp} />
      </p>
      <ul className="flex flex-col gap-0.5">
        {chart.series.map((series, index) => {
          const value = valueAt(series, timestamp);
          return (
            <li className="flex items-center gap-1.5" key={series.label}>
              <Swatch index={index} />
              {chart.series.length > 1 && <span className="text-muted-foreground">{series.label}</span>}
              <span className="ml-auto font-medium">{value === null ? '—' : formatReading(value, chart)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const summaryOf = (chart: LoadChartData): string =>
  `${chart.label}: ${chart.series
    .map((series) => {
      const latest = latestValue(series);
      return `${series.label} ${latest === null ? 'no data' : formatReading(latest, chart)}`;
    })
    .join(', ')}`;

export function LoadChart({ chart }: { chart: LoadChartData }) {
  const timestamps = chartTimestamps(chart);
  const ceiling = chartCeiling(chart);
  const scale = scaleFor(timestamps, ceiling);
  const [active, setActive] = useState<number | null>(null);
  const near = isNearLimit(chart);
  const single = chart.series.length === 1 ? chart.series[0] : undefined;
  const singleLatest = single ? latestValue(single) : null;
  const activeTimestamp = active === null ? undefined : timestamps[active];

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    const nearest = timestamps.reduce(
      (best, timestamp, index) =>
        Math.abs(scale.x(timestamp) - ratio) < Math.abs(scale.x(timestamps[best] ?? '') - ratio) ? index : best,
      0,
    );
    setActive(nearest);
  };

  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (move === undefined || timestamps.length === 0) {
      return;
    }
    event.preventDefault();
    setActive((current) => Math.min(timestamps.length - 1, Math.max(0, (current ?? timestamps.length) + move)));
  };

  return (
    <figure className="flex flex-col gap-3 rounded-xl border p-4">
      <figcaption className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-col">
          <span className="text-[13px] text-muted-foreground">
            {chart.label}
            {chart.note && <span className="text-faint"> · {chart.note}</span>}
          </span>
          {single && (
            <span className="text-xl font-semibold">
              {singleLatest === null ? '—' : formatReading(singleLatest, chart)}
            </span>
          )}
        </span>
        {near && (
          <Badge tone="warning">
            <TriangleAlert className="size-3" aria-hidden="true" />
            Near limit
          </Badge>
        )}
      </figcaption>
      {!single && <Legend chart={chart} />}
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
        <div className="flex flex-col justify-between text-[11px] text-faint" aria-hidden="true">
          <span>{formatLoadValue(ceiling, chart.unit)}</span>
          <span>{formatLoadValue(0, chart.unit)}</span>
        </div>
        <div
          className="relative h-28 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          role="img"
          aria-label={summaryOf(chart)}
          tabIndex={0}
          onPointerMove={pick}
          onPointerLeave={() => setActive(null)}
          onKeyDown={step}
          onBlur={() => setActive(null)}
        >
          <svg
            className="absolute inset-0 size-full overflow-visible"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {[0, HEIGHT].map((y) => (
              <line key={y} x1={0} x2={WIDTH} y1={y} y2={y} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
            ))}
            {chart.warnAbove !== null && chart.warnAbove < ceiling && (
              <line
                x1={0}
                x2={WIDTH}
                y1={scale.y(chart.warnAbove) * HEIGHT}
                y2={scale.y(chart.warnAbove) * HEIGHT}
                stroke="var(--warning)"
                strokeOpacity={0.5}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {chart.series.map((series, index) => (
              <path
                key={series.label}
                d={pathOf(series, scale)}
                fill="none"
                stroke={SERIES_COLORS[index]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {activeTimestamp && (
            <>
              <span
                className="pointer-events-none absolute inset-y-0 w-px bg-faint"
                style={{ left: percent(scale.x(activeTimestamp)) }}
              />
              {chart.series.map((series, index) => {
                const value = valueAt(series, activeTimestamp);
                return value === null ? null : (
                  <span
                    key={series.label}
                    className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                    style={{
                      left: percent(scale.x(activeTimestamp)),
                      top: percent(scale.y(value)),
                      background: SERIES_COLORS[index],
                    }}
                  />
                );
              })}
              <Tooltip chart={chart} timestamp={activeTimestamp} x={scale.x(activeTimestamp)} />
            </>
          )}
        </div>
        {timestamps.length > 0 && (
          <div className="col-start-2 flex justify-between text-[11px] text-faint">
            <Time value={timestamps[0] ?? ''} />
            <Time value={timestamps.at(-1) ?? ''} />
          </div>
        )}
      </div>
    </figure>
  );
}
