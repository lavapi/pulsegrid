'use client';

import {
  type ActionRun,
  CARD_LOAD_MAX_RESOURCES,
  type CardLoadMap,
  RESOURCE_TYPES,
  type Resource,
  type ResourceType,
} from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiSendForJson } from '@/lib/browser-api';
import { cardLoadBatches, hasCardLoad } from '@/lib/card-load';
import { justFinished, runsByResource } from '@/lib/resource-cards';
import { ResourceCard } from './resource-card';

const POLL_MS = 5000;
const LOAD_REFRESH_MS = 60_000;

/** The latest load of every card that shows one, in as few requests as the API allows; null when unreadable. */
const useCardLoad = (resources: readonly Resource[]): CardLoadMap | null | undefined => {
  const ids = useMemo(
    () => resources.filter(({ type }) => hasCardLoad(type)).map(({ id }) => id).sort(),
    [resources],
  );
  const key = ids.join(',');
  const [load, setLoad] = useState<CardLoadMap | null | undefined>(undefined);

  useEffect(() => {
    if (!key) {
      return;
    }
    let active = true;
    const read = async () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      const answers = await Promise.all(
        cardLoadBatches(key.split(','), CARD_LOAD_MAX_RESOURCES).map((batch) =>
          apiSendForJson<CardLoadMap>(`/resources/card-load?ids=${batch.join(',')}`, 'GET'),
        ),
      );
      if (active) {
        setLoad(answers.every(({ data }) => !data) ? null : Object.assign({}, ...answers.map(({ data }) => data ?? {})));
      }
    };
    void read();
    const timer = setInterval(() => void read(), LOAD_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [key]);

  return load;
};

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
  const load = useCardLoad(resources);

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
              <ResourceCard
                key={resource.id}
                resource={resource}
                run={byResource.get(resource.id)}
                load={load === undefined || load === null ? load : (load[resource.id] ?? null)}
              />
            ))}
          </div>
        </section>
      )
    );
  });
}
