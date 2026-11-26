import type { DatabaseAccessRequest } from '@pulsegrid/shared';

const DECISION_RECENT_MS = 24 * 3_600_000;
const REMEMBERED_IDS = 50;

export interface PersonAlert {
  title: string;
  body: string;
  /** Where clicking the alert goes. */
  href: string;
  /** Ties the browser notification to one request, so it replaces rather than stacks. */
  tag: string;
}

const hoursText = (hours: number): string => `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

/** Waiting requests this browser hasn't alerted about yet. */
export const unseenRequests = (
  pending: readonly DatabaseAccessRequest[],
  seen: ReadonlySet<string>,
): DatabaseAccessRequest[] => pending.filter(({ id }) => !seen.has(id));

/** The person's request, when it was just answered and they haven't been told yet. */
export const decisionToAnnounce = (
  request: DatabaseAccessRequest | null,
  told: ReadonlySet<string>,
  now: number,
): DatabaseAccessRequest | null => {
  if (!request?.decidedAt || (request.status !== 'approved' && request.status !== 'declined')) return null;
  if (told.has(request.id) || now - Date.parse(request.decidedAt) > DECISION_RECENT_MS) return null;
  return request;
};

export const requestAlert = (request: DatabaseAccessRequest): PersonAlert => ({
  title: 'Database access request',
  body: `${request.requestedBy} asks for ${hoursText(request.hours)}: ${request.reason}`,
  href: '/settings/database-access',
  tag: `database-access-request-${request.id}`,
});

export const requestsAlert = (requests: readonly DatabaseAccessRequest[]): PersonAlert =>
  requests.length === 1
    ? requestAlert(requests[0]!)
    : {
        title: 'Database access requests',
        body: `${requests.length} people are waiting for database access.`,
        href: '/settings/database-access',
        tag: 'database-access-requests',
      };

export const decisionAlert = (request: DatabaseAccessRequest): PersonAlert => {
  const by = request.decidedBy ?? 'An approver';
  return request.status === 'approved'
    ? {
        title: 'Database access approved',
        body: `${by} approved ${hoursText(request.hours)}. Open Database access to connect once it's ready.`,
        href: '/database-access',
        tag: `database-access-decision-${request.id}`,
      }
    : {
        title: 'Database access declined',
        body: request.declineReason ? `${by} declined: ${request.declineReason}` : `${by} declined your request.`,
        href: '/database-access',
        tag: `database-access-decision-${request.id}`,
      };
};

/** Ids this browser has alerted about, kept across reloads; empty where storage is blocked. */
export const rememberedIds = (key: string): Set<string> => {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
};

export const rememberIds = (key: string, ids: Iterable<string>): void => {
  try {
    localStorage.setItem(key, JSON.stringify([...ids].slice(-REMEMBERED_IDS)));
  } catch {
    // Without storage, alerts can repeat after a reload; nothing else depends on it.
  }
};
