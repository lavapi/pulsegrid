import { type ExperimentResource, type LoadWindow, type RunResult, supportsLoad } from '@pulsegrid/shared';
import { ResourceLoad } from '@/components/infrastructure/load/resource-load';
import { Card, CardHeader } from '@/components/ui/card';
import { Time } from '@/components/ui/time';
import { resultLabel, resultTone } from '@/lib/experiments';
import { cn } from '@/lib/utils';

const LOAD_LIMIT = 4;

const BAR_TONES = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-faint',
} as const;

export interface TimelineRow {
  key: string;
  label: string;
  result: RunResult;
  startedAt: string | null;
  endedAt: string | null;
  steps: { name: string; startedAt: string | null; endedAt: string | null }[];
}

const clamp = (value: number): number => Math.min(Math.max(value, 0), 1);

/** Where a bar sits on the axis; a bar with no end runs to the given fallback, never past the axis. */
const position = (from: number, span: number, start: string | null, end: number) => {
  const left = clamp(start ? (Date.parse(start) - from) / span : 0);
  const right = clamp((end - from) / span);
  return { left: `${left * 100}%`, width: `${Math.max(right - left, 0.005) * 100}%` };
};

/** Every test of a run on one time axis, with its steps underneath, so overlaps are easy to see. */
export function RunTimeline({ rows }: { rows: readonly TimelineRow[] }) {
  const now = Date.now();
  const starts = rows.flatMap(({ startedAt }) => (startedAt ? [Date.parse(startedAt)] : []));
  const ends = rows.map(({ endedAt }) => (endedAt ? Date.parse(endedAt) : now));
  if (starts.length === 0) {
    return null;
  }
  const from = Math.min(...starts);
  const span = Math.max(Math.max(...ends) - from, 1);
  const edge = (value: number) => new Date(value).toISOString();
  return (
    <Card>
      <CardHeader title="Timeline" description="Each test and its steps on the same time axis." />
      <div className="flex flex-col gap-4 p-5">
        <div className="flex justify-between text-[12px] text-muted-foreground">
          <Time value={edge(from)} />
          <Time value={edge(from + span)} />
        </div>
        {rows.map((row) => {
          const rowEnd = row.endedAt ? Date.parse(row.endedAt) : now;
          return (
          <div key={row.key} className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">
              {row.label} <span className="font-normal text-muted-foreground">· {resultLabel(row.result)}</span>
            </span>
            <div className="relative h-3 overflow-hidden rounded bg-muted" role="img" aria-label={`${row.label} timing`}>
              {row.startedAt && (
                <span
                  className={cn('absolute inset-y-0 rounded', BAR_TONES[resultTone(row.result)])}
                  style={position(from, span, row.startedAt, rowEnd)}
                />
              )}
            </div>
            {row.steps
              .filter(({ startedAt }) => startedAt)
              .map((step) => (
                <div key={step.name} className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-3">
                  <span className="truncate text-[12px] text-muted-foreground">{step.name}</span>
                  <div className="relative h-1.5 overflow-hidden rounded bg-muted">
                    <span
                      className="absolute inset-y-0 rounded bg-faint"
                      style={position(from, span, step.startedAt, step.endedAt ? Date.parse(step.endedAt) : rowEnd)}
                    />
                  </div>
                </div>
              ))}
          </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Load for the databases and caches the tests hit, over the whole test window. */
export function ReportLoads({
  resources,
  timeWindow,
}: {
  resources: readonly ExperimentResource[];
  timeWindow: LoadWindow | null;
}) {
  const withLoad = resources.filter(({ type }) => supportsLoad(type)).slice(0, LOAD_LIMIT);
  if (!timeWindow || withLoad.length === 0) {
    return null;
  }
  return (
    <>
      {withLoad.map((resource) => (
        <ResourceLoad
          key={resource.id}
          resourceId={resource.id}
          title={`Load · ${resource.name}`}
          timeWindow={timeWindow}
        />
      ))}
    </>
  );
}
