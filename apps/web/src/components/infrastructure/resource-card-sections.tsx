'use client';

import {
  type ActionRun,
  RESOURCE_TYPES,
  type Resource,
  type ResourceType,
} from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiSendForJson } from '@/lib/browser-api';
import { justFinished, runsByResource } from '@/lib/resource-cards';
import { ResourceCard } from './resource-card';

const POLL_MS = 5000;

interface ResourceCardSectionsProps {
  accountId: string;
  types: ResourceType[];
  resources: Resource[];
  initialRuns: ActionRun[];
}

export function ResourceCardSections({ accountId, types, resources, initialRuns }: ResourceCardSectionsProps) {
  const router = useRouter();
  const [runs, setRuns] = useState(initialRuns);
  const latest = useRef(initialRuns);
  const byResource = useMemo(() => runsByResource(runs), [runs]);

  useEffect(() => {
    const timer = setInterval(async () => {
      const { data } = await apiSendForJson<ActionRun[]>(`/resource-activity?account=${accountId}`, 'GET');
      if (!data) {
        return;
      }
      if (justFinished(latest.current, data)) {
        router.refresh();
      }
      latest.current = data;
      setRuns(data);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [accountId, router]);

  return types.map((type) => {
    const items = resources.filter((item) => item.type === type);
    return (
      items.length > 0 && (
        <section className="flex flex-col gap-3" key={type}>
          <h2 className="text-sm font-medium">
            {RESOURCE_TYPES[type].label} ({items.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} run={byResource.get(resource.id)} />
            ))}
          </div>
        </section>
      )
    );
  });
}
