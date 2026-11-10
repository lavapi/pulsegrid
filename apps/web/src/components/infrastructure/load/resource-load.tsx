'use client';

import { LOAD_RANGES, LOAD_SERIES_LIMIT, type LoadRange, type ResourceLoad as ResourceLoadData } from '@pulsegrid/shared';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiSendForJson } from '@/lib/browser-api';
import { LoadChart } from './load-chart';

function CapacityFacts({ load }: { load: ResourceLoadData }) {
  if (load.capacity.length === 0) {
    return null;
  }
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 border-b px-5 py-3 text-[13px]">
      {load.capacity.map(({ label, value }) => (
        <div className="flex flex-col" key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Charts({ load }: { load: ResourceLoadData }) {
  if (load.error) {
    return <p className="p-5 text-sm text-danger">{load.error}</p>;
  }
  if (load.charts.length === 0) {
    return <p className="p-5 text-sm text-muted-foreground">AWS has no load data for this time range.</p>;
  }
  return (
    <div className="flex flex-col gap-3 p-5">
      {load.hiddenSeries > 0 && (
        <p className="text-[13px] text-muted-foreground">
          Showing the first {LOAD_SERIES_LIMIT} nodes. {load.hiddenSeries}{' '}
          {load.hiddenSeries === 1 ? "more isn't" : "more aren't"} shown.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {load.charts.map((chart) => (
          <LoadChart chart={chart} key={chart.id} />
        ))}
      </div>
    </div>
  );
}

export function ResourceLoad({ resourceId }: { resourceId: string }) {
  const [range, setRange] = useState<LoadRange>(LOAD_RANGES[0]);
  const [load, setLoad] = useState<ResourceLoadData | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoad(null);
    void apiSendForJson<ResourceLoadData>(`/resources/${resourceId}/load?range=${range.id}`, 'GET').then(
      ({ data, error }) => {
        if (current) {
          setLoad(data);
          setFailure(error);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [range, resourceId]);

  return (
    <Card>
      <CardHeader title="Load" description="From CloudWatch, read when you open this page." />
      <div className="flex border-b px-5 py-3">
        <div className="flex rounded-lg border p-0.5" role="group" aria-label="Time range">
          {LOAD_RANGES.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={range.id === item.id ? 'secondary' : 'ghost'}
              aria-pressed={range.id === item.id}
              aria-label={item.label}
              onClick={() => setRange(item)}
            >
              {item.id}
            </Button>
          ))}
        </div>
      </div>
      {failure && <p className="p-5 text-sm text-danger">{failure}</p>}
      {!failure && !load && (
        <div className="grid gap-3 p-5 md:grid-cols-2">
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
        </div>
      )}
      {load && (
        <>
          <CapacityFacts load={load} />
          <Charts load={load} />
        </>
      )}
    </Card>
  );
}
