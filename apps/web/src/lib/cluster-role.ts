import type { Resource } from '@pulsegrid/shared';
import type { Tone } from './tone';

const ROLES: Record<string, { label: string; tone: Tone }> = {
  writer: { label: 'Writer', tone: 'primary' },
  reader: { label: 'Reader', tone: 'neutral' },
};

/** The part a database plays in its cluster, as the last sync saw it; null outside a cluster. */
export const clusterRole = ({ details }: Pick<Resource, 'details'>): { label: string; tone: Tone } | null =>
  (typeof details['role'] === 'string' && ROLES[details['role']]) || null;

export const formatRole = (value: unknown): string => (typeof value === 'string' && ROLES[value]?.label) || '—';
