'use client';

import type { ResourceLoad } from '@pulsegrid/shared';
import { useEffect, useState } from 'react';
import { apiSendForJson } from '@/lib/browser-api';
import { type CardMeter, cardMeters } from '@/lib/card-load';
import { cn } from '@/lib/utils';

const REFRESH_MS = 60_000;

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

/** The resource's latest CPU, connections and memory, refreshed every minute while the page is visible. */
export function CardLoad({ resourceId }: { resourceId: string }) {
  const [meters, setMeters] = useState<CardMeter[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      const { data } = await apiSendForJson<ResourceLoad>(`/resources/${resourceId}/load?range=1h`, 'GET');
      if (!active) {
        return;
      }
      setFailed(!data?.available);
      setMeters(data?.available ? cardMeters(data) : []);
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [resourceId]);

  return (
    <div className="flex flex-col gap-2.5 border-t px-4 py-3" aria-label="Load in the last hour">
      {meters === null ? (
        <div className="h-[86px] animate-pulse rounded-md bg-muted/60" />
      ) : failed || meters.length === 0 ? (
        <p className="text-xs text-muted-foreground">Load not available right now.</p>
      ) : (
        meters.map((meter) => <Meter meter={meter} key={meter.label} />)
      )}
    </div>
  );
}
