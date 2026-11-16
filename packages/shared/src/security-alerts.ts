export const ALERT_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_SOURCES = ['guardduty', 'securityhub', 'root-activity', 'other'] as const;
export type AlertSource = (typeof ALERT_SOURCES)[number];

export const ALERT_STATUSES = ['new', 'acknowledged', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** Severities that notify when an alert first arrives. */
export const NOTIFYING_SEVERITIES: readonly AlertSeverity[] = ['CRITICAL', 'HIGH'];

export const ALERT_SOURCE_LABELS: Record<AlertSource, string> = {
  guardduty: 'GuardDuty',
  securityhub: 'Security Hub',
  'root-activity': 'Root activity',
  other: 'Other',
};

export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
};

export interface SecurityAlert {
  id: string;
  source: AlertSource;
  severity: AlertSeverity;
  title: string;
  accountId: string;
  accountName: string | null;
  region: string | null;
  occurredAt: string;
  lastSeenAt: string;
  status: AlertStatus;
}

export interface SecurityAlertStatusChange {
  from: AlertStatus;
  to: AlertStatus;
  changedBy: string;
  changedAt: string;
}

/** What AWS says about the finding or the root activity, shown on the alert's page. */
export interface SecurityAlertFacts {
  findingId?: string;
  updatedAt?: string;
  workflowStatus?: string;
  recordState?: string;
  complianceStatus?: string;
  resourceIds?: string[];
  eventName?: string;
  sourceIpAddress?: string;
  userAgent?: string;
  consoleLogin?: string;
  detailType?: string;
}

export interface SecurityAlertDetail extends SecurityAlert {
  consoleUrl: string | null;
  facts: SecurityAlertFacts;
  rawEvent: unknown;
  statusChangedBy: string | null;
  statusChangedAt: string | null;
  history: SecurityAlertStatusChange[];
}

export interface SecurityAlertPage {
  alerts: SecurityAlert[];
  nextCursor: string | null;
}

export interface SecurityAlertFilterOptions {
  accounts: { id: string; name: string | null }[];
  regions: string[];
}

export interface SlackIntegration {
  connected: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}
