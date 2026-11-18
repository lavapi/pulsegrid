import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { ProductionRelease, ProductionReleaseComponent, ProductionReleaseDecision } from '@pulsegrid/shared';

export type ReleaseItem = Record<string, AttributeValue>;

export const ACTIVE_ID = 'ACTIVE';

const text = (item: ReleaseItem, name: string): string | null => {
  const value = item[name];
  const raw = value?.S ?? value?.N;
  return raw === undefined || raw === '' ? null : raw;
};

/** Unix seconds, stored as a string or a number, as an ISO time; null when missing or not a time. */
const time = (item: ReleaseItem, name: string): string | null => {
  const seconds = Number(text(item, name));
  return text(item, name) !== null && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
};

const json = (item: ReleaseItem, name: string): unknown => {
  try {
    return JSON.parse(text(item, name) ?? 'null') as unknown;
  } catch {
    return null;
  }
};

const components = (item: ReleaseItem): ProductionReleaseComponent[] => {
  const tags = json(item, 'tags');
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) {
    return [];
  }
  return Object.entries(tags)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, tag]) => ({ name, tag }))
    .sort((left, right) => left.name.localeCompare(right.name));
};

const decision = (item: ReleaseItem): ProductionReleaseDecision | null => {
  const value = text(item, 'decision')?.toUpperCase();
  return value === 'FINISH' || value === 'ROLLBACK' ? value : null;
};

/** The release item as the page shows it; the per-service deployment details stay out. */
export const toRelease = (item: ReleaseItem): ProductionRelease => ({
  id: text(item, 'id') ?? '',
  status: text(item, 'status') ?? 'UNKNOWN',
  components: components(item),
  requestedBy: text(item, 'requested_by'),
  createdAt: time(item, 'created_at'),
  holdStartedAt: time(item, 'hold_started_at'),
  holdUntil: time(item, 'hold_until'),
  decision: decision(item),
  decidedBy: text(item, 'decided_by'),
  snapshot: text(item, 'snapshot'),
});

export const activeReleaseId = (item: ReleaseItem | undefined): string | null =>
  item ? text(item, 'release_id') : null;

/** Newest first by when they started; releases without a start time go last. */
export const newestFirst = (releases: ProductionRelease[], limit: number): ProductionRelease[] =>
  [...releases]
    .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))
    .slice(0, limit);
