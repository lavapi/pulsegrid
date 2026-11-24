import type { LoadChart, ResourceType } from '@pulsegrid/shared';
import { type CardMeter, cardMeters } from '@/lib/card-load';
import { cn } from '@/lib/utils';

function Meter({ meter }: { meter: CardMeter }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{meter.label}</span>
        <span className={cn('truncate tabular-nums', meter.warn && 'font-medium text-warning')}>{meter.reading}</span>
      </div>
      {meter.share !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className={cn('h-full rounded-full', meter.warn ? 'bg-warning' : 'bg-primary')}
            style={{ width: `${Math.max(2, meter.share * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** The resource's latest load; `charts` is undefined while loading and null when it couldn't be read. */
export function CardLoad({ type, charts }: { type: ResourceType; charts: LoadChart[] | null | undefined }) {
  const meters = charts ? cardMeters(type, charts) : [];
  return (
    <div className="flex flex-col gap-2.5 border-t px-4 py-3" aria-label="Load in the last few minutes">
      {charts === undefined ? (
        <div className="h-16 animate-pulse rounded-md bg-muted/60" />
      ) : meters.length === 0 ? (
        <p className="text-xs text-muted-foreground">Load not available right now.</p>
      ) : (
        meters.map((meter) => <Meter meter={meter} key={meter.label} />)
      )}
    </div>
  );
}
