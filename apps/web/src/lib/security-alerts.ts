import {
  ALERT_SEVERITIES,
  ALERT_SOURCE_LABELS,
  ALERT_SOURCES,
  ALERT_STATUS_LABELS,
  ALERT_STATUSES,
  type AlertSeverity,
  type AlertStatus,
  type SecurityAlert,
  type SecurityAlertFacts,
} from '@pulsegrid/shared';
import type { Tone } from './tone';

export const SEVERITY_TONES: Record<AlertSeverity, Tone> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'neutral',
  INFORMATIONAL: 'neutral',
};

export const STATUS_TONES: Record<AlertStatus, Tone> = {
  new: 'primary',
  acknowledged: 'warning',
  resolved: 'success',
};

export const severityLabel = (severity: AlertSeverity): string =>
  severity.charAt(0) + severity.slice(1).toLowerCase();

export const SEVERITY_OPTIONS = ALERT_SEVERITIES.map((value) => ({ value, label: severityLabel(value) }));
export const SOURCE_OPTIONS = ALERT_SOURCES.map((value) => ({ value, label: ALERT_SOURCE_LABELS[value] }));
export const STATUS_OPTIONS = ALERT_STATUSES.map((value) => ({ value, label: ALERT_STATUS_LABELS[value] }));

export const accountLabel = ({ accountId, accountName }: Pick<SecurityAlert, 'accountId' | 'accountName'>): string =>
  accountName ? `${accountName} (${accountId})` : accountId || 'Unknown account';

const FILTERS = ['severity', 'source', 'account', 'region', 'status', 'cursor'] as const;
const END_OF_DAY = 'T23:59:59.999Z';

/** The API query for the page's filters; date filters cover whole days. */
export const alertQuery = (params: Record<string, string | undefined>): URLSearchParams => {
  const query = new URLSearchParams();
  FILTERS.forEach((name) => {
    const value = params[name];
    if (value) query.set(name, value);
  });
  if (params['from']) query.set('from', params['from']);
  if (params['to']) query.set('to', `${params['to']}${END_OF_DAY}`);
  return query;
};

const FACT_LABELS: [keyof SecurityAlertFacts, string][] = [
  ['eventName', 'Action'],
  ['consoleLogin', 'Sign-in result'],
  ['sourceIpAddress', 'Source IP address'],
  ['userAgent', 'User agent'],
  ['workflowStatus', 'Workflow status'],
  ['recordState', 'Record state'],
  ['complianceStatus', 'Compliance status'],
  ['updatedAt', 'Updated in AWS'],
  ['detailType', 'Event type'],
  ['findingId', 'Finding ID'],
];

/** The facts AWS sent, as label and value pairs, skipping those it didn't send. */
export const alertFacts = (facts: SecurityAlertFacts): { label: string; value: string }[] => [
  ...FACT_LABELS.flatMap(([key, label]) => {
    const value = facts[key];
    return typeof value === 'string' && value ? [{ label, value }] : [];
  }),
  ...(facts.resourceIds?.length ? [{ label: 'Resources', value: facts.resourceIds.join('\n') }] : []),
];

/** The buttons that move an alert on from its status. */
export const NEXT_STATUSES: Record<AlertStatus, { status: AlertStatus; label: string }[]> = {
  new: [
    { status: 'acknowledged', label: 'Acknowledge' },
    { status: 'resolved', label: 'Resolve' },
  ],
  acknowledged: [
    { status: 'resolved', label: 'Resolve' },
    { status: 'new', label: 'Mark as new' },
  ],
  resolved: [{ status: 'new', label: 'Reopen' }],
};
