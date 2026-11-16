import {
  ALERT_SEVERITIES,
  type AlertSeverity,
  type AlertSource,
  type SecurityAlertFacts,
} from '@pulsegrid/shared';
import { z } from 'zod';

/** One alert, ready to store: keyed so the same finding or event always lands on the same record. */
export interface NormalizedAlert {
  key: string;
  source: AlertSource;
  severity: AlertSeverity;
  title: string;
  accountId: string;
  region: string | null;
  occurredAt: Date;
  /** When AWS last changed the finding, so an older update never replaces a newer one. */
  updatedAt: Date;
  consoleUrl: string | null;
  facts: SecurityAlertFacts;
  rawEvent: unknown;
}

const FINDINGS = 'Security Hub Findings - Imported';
const CONSOLE_SIGN_IN = 'AWS Console Sign In via CloudTrail';
const API_CALL = 'AWS API Call via CloudTrail';
const TITLE_LIMIT = 300;

const eventSchema = z.object({
  id: z.string().min(1),
  'detail-type': z.string().min(1),
  account: z.string().default(''),
  region: z.string().optional(),
  time: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).default({}),
});

/** The parsed fields, and the event exactly as AWS sent it. */
type EventBridgeEvent = z.infer<typeof eventSchema> & { raw: unknown };

const findingSchema = z.object({
  Id: z.string().min(1),
  ProductName: z.string().optional(),
  ProductArn: z.string().optional(),
  Title: z.string().optional(),
  AwsAccountId: z.string().optional(),
  Region: z.string().optional(),
  CreatedAt: z.string().optional(),
  UpdatedAt: z.string().optional(),
  Severity: z.object({ Label: z.string().optional() }).optional(),
  Workflow: z.object({ Status: z.string().optional() }).optional(),
  RecordState: z.string().optional(),
  Compliance: z.object({ Status: z.string().optional() }).optional(),
  Resources: z.array(z.object({ Id: z.string() })).optional(),
});

type Finding = z.infer<typeof findingSchema>;

const rootSchema = z.object({
  eventName: z.string().default('an action'),
  eventID: z.string().optional(),
  eventTime: z.string().optional(),
  awsRegion: z.string().optional(),
  sourceIPAddress: z.string().optional(),
  userAgent: z.string().optional(),
  userIdentity: z.object({ type: z.string().optional() }).optional(),
  responseElements: z.object({ ConsoleLogin: z.string().optional() }).nullish(),
});

const severityOf = (label: string | undefined): AlertSeverity =>
  ALERT_SEVERITIES.find((severity) => severity === label?.toUpperCase()) ?? 'INFORMATIONAL';

const dateOr = (value: string | undefined, fallback: Date): Date => {
  const parsed = value ? new Date(value) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const short = (text: string): string => (text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT - 1)}…` : text);

const consoleHome = (service: string, region: string): string =>
  `https://${region}.console.aws.amazon.com/${service}/home?region=${region}`;

const isGuardDuty = (finding: Finding): boolean =>
  finding.ProductName === 'GuardDuty' || Boolean(finding.ProductArn?.includes('/guardduty'));

const findingUrl = (finding: Finding, guardDuty: boolean, region: string | null): string | null => {
  if (!region) {
    return null;
  }
  if (guardDuty) {
    const guardDutyId = finding.Id.split('/finding/')[1];
    return guardDutyId ? `${consoleHome('guardduty', region)}#/findings?fId=${encodeURIComponent(guardDutyId)}` : null;
  }
  const search = `Id=\\operator\\:EQUALS\\:${finding.Id}`;
  return `${consoleHome('securityhub', region)}#/findings?search=${encodeURIComponent(search)}`;
};

const fromFinding = (event: EventBridgeEvent, finding: Finding, receivedAt: Date): NormalizedAlert => {
  const guardDuty = isGuardDuty(finding);
  const region = finding.Region ?? event.region ?? null;
  const occurredAt = dateOr(finding.CreatedAt, receivedAt);
  return {
    key: finding.Id,
    source: guardDuty ? 'guardduty' : 'securityhub',
    severity: severityOf(finding.Severity?.Label),
    title: short(finding.Title ?? 'Security Hub finding'),
    accountId: finding.AwsAccountId ?? event.account,
    region,
    occurredAt,
    updatedAt: dateOr(finding.UpdatedAt, occurredAt),
    consoleUrl: findingUrl(finding, guardDuty, region),
    facts: {
      findingId: finding.Id,
      updatedAt: finding.UpdatedAt,
      workflowStatus: finding.Workflow?.Status,
      recordState: finding.RecordState,
      complianceStatus: finding.Compliance?.Status,
      resourceIds: finding.Resources?.map(({ Id }) => Id) ?? [],
    },
    rawEvent: event.raw,
  };
};

const fromFindings = (event: EventBridgeEvent, receivedAt: Date): NormalizedAlert[] => {
  const findings = Array.isArray(event.detail.findings) ? event.detail.findings : [];
  return findings.flatMap((item) => {
    const finding = findingSchema.safeParse(item);
    return finding.success ? [fromFinding(event, finding.data, receivedAt)] : [];
  });
};

const rootTitle = (detail: z.infer<typeof rootSchema>): string => {
  if (detail.eventName === 'ConsoleLogin') {
    const result = detail.responseElements?.ConsoleLogin;
    return result ? `Root user signed in to the console (${result})` : 'Root user signed in to the console';
  }
  return `Root user called ${detail.eventName}`;
};

const fromRootActivity = (event: EventBridgeEvent, receivedAt: Date): NormalizedAlert => {
  const detail = rootSchema.parse(event.detail);
  const region = detail.awsRegion ?? event.region ?? null;
  const occurredAt = dateOr(detail.eventTime ?? event.time, receivedAt);
  return {
    key: event.id,
    source: 'root-activity',
    severity: 'CRITICAL',
    title: short(rootTitle(detail)),
    accountId: event.account,
    region,
    occurredAt,
    updatedAt: occurredAt,
    consoleUrl:
      region && detail.eventID
        ? `https://${region}.console.aws.amazon.com/cloudtrailv2/home?region=${region}#/events/${encodeURIComponent(detail.eventID)}`
        : null,
    facts: {
      eventName: detail.eventName,
      sourceIpAddress: detail.sourceIPAddress,
      userAgent: detail.userAgent,
      consoleLogin: detail.responseElements?.ConsoleLogin ?? undefined,
    },
    rawEvent: event.raw,
  };
};

const isRootActivity = (event: EventBridgeEvent): boolean =>
  (event['detail-type'] === CONSOLE_SIGN_IN || event['detail-type'] === API_CALL) &&
  rootSchema.safeParse(event.detail).data?.userIdentity?.type === 'Root';

const fromOtherEvent = (event: EventBridgeEvent, receivedAt: Date): NormalizedAlert => {
  const occurredAt = dateOr(event.time, receivedAt);
  return {
    key: event.id,
    source: 'other',
    severity: 'INFORMATIONAL',
    title: short(event['detail-type']),
    accountId: event.account,
    region: event.region ?? null,
    occurredAt,
    updatedAt: occurredAt,
    consoleUrl: null,
    facts: { detailType: event['detail-type'] },
    rawEvent: event.raw,
  };
};

/** Turns an EventBridge event into the alerts it carries, or null when the text isn't an EventBridge event. */
export const normalizeEvent = (message: string, receivedAt = new Date()): NormalizedAlert[] | null => {
  let json: unknown;
  try {
    json = JSON.parse(message);
  } catch {
    return null;
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const event = { ...parsed.data, raw: json };
  if (event['detail-type'] === FINDINGS) {
    return fromFindings(event, receivedAt);
  }
  return [isRootActivity(event) ? fromRootActivity(event, receivedAt) : fromOtherEvent(event, receivedAt)];
};
