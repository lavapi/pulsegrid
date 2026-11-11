import type { ResourceType } from '@pulsegrid/shared';

export interface ResourceTab {
  id: string;
  label: string;
}

const OVERVIEW: ResourceTab = { id: 'overview', label: 'Overview' };

const TABS: Partial<Record<ResourceType, ResourceTab[]>> = {
  'load-balancer': [OVERVIEW, { id: 'requests', label: 'Request log' }],
  'rds-cluster': [OVERVIEW, { id: 'queries', label: 'Query activity' }],
  'rds-instance': [OVERVIEW, { id: 'queries', label: 'Query activity' }],
};

/** The tabs a resource page shows, or none when it only has an overview. */
export const resourceTabs = (type: ResourceType): ResourceTab[] => TABS[type] ?? [];

/** The tab to show: the one asked for when the resource has it, otherwise the overview. */
export const activeTab = (type: ResourceType, wanted: string | undefined): string =>
  resourceTabs(type).some(({ id }) => id === wanted) ? (wanted as string) : OVERVIEW.id;

/** The query string for a log read, leaving out empty filters. */
export const requestLogQuery = (filter: object): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter) as [string, unknown][]) {
    if (value !== undefined && value !== '' && value !== false) {
      params.set(key, String(value));
    }
  }
  return params.toString();
};

export const formatMs = (ms: number | null): string => {
  if (ms === null) {
    return '—';
  }
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s` : `${Math.round(ms)} ms`;
};

export const formatShare = (share: number): string =>
  share > 0 && share < 0.001 ? '<0.1%' : `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`;

/** The tone of a status: errors red, client errors amber, the rest plain. */
export const statusTone = (status: number | null): 'danger' | 'warning' | 'neutral' => {
  if (status === null) {
    return 'neutral';
  }
  if (status >= 500) {
    return 'danger';
  }
  return status >= 400 ? 'warning' : 'neutral';
};
