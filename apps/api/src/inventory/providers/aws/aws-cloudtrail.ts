import {
  CloudTrailClient,
  type Event as TrailEvent,
  type LookupAttribute,
  LookupEventsCommand,
} from '@aws-sdk/client-cloudtrail';
import type { CloudActivityEvent } from '@pulsegrid/shared';
import type { ActivityQuery, ActivitySource } from '../provider';
import type { AwsKey } from './aws-key';

const PAGE_SIZE = 50;
const GLOBAL_REGION = 'us-east-1';
const UNKNOWN_ACTOR = 'Unknown';

const ACTION_LABELS: Record<string, string> = {
  ConsoleLogin: 'Signed in to the console',
  CreateSecret: 'Create secret',
  DeleteSecret: 'Delete secret',
  PutSecretValue: 'Change secret',
  UpdateSecret: 'Change secret',
  RebootDBInstance: 'Reboot database',
  RebootCacheCluster: 'Reboot cache',
  RebootInstances: 'Reboot server',
  RunInstances: 'Start new server',
  StartInstances: 'Start server',
  StopInstances: 'Stop server',
  TerminateInstances: 'Terminate server',
  UpdateService: 'Update ECS service',
};

interface UserIdentity {
  type?: string;
  userName?: string;
  principalId?: string;
  accessKeyId?: string;
  invokedBy?: string;
  sessionContext?: { sessionIssuer?: { userName?: string } };
}

interface TrailRecord {
  userIdentity?: UserIdentity;
  sourceIPAddress?: string;
  errorCode?: string;
  awsRegion?: string;
}

const parseRecord = (text: string | undefined): TrailRecord => {
  try {
    return JSON.parse(text ?? '{}') as TrailRecord;
  } catch {
    return {};
  }
};

export const actionLabel = (name: string): string =>
  ACTION_LABELS[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2');

const roleActor = ({ principalId, sessionContext }: UserIdentity): string | undefined => {
  const session = principalId?.split(':')[1];
  if (session?.includes('@')) {
    return session;
  }
  const role = sessionContext?.sessionIssuer?.userName;
  return role && session ? `${role} (${session})` : (role ?? session);
};

export const actorOf = (identity: UserIdentity | undefined, username: string | undefined): string => {
  if (identity?.type === 'Root') {
    return 'Root user';
  }
  const named =
    identity?.type === 'AssumedRole'
      ? roleActor(identity)
      : (identity?.userName ?? identity?.invokedBy);
  return named ?? username ?? UNKNOWN_ACTOR;
};

const toActivity = (event: TrailEvent, region: string, keyId: string): CloudActivityEvent => {
  const record = parseRecord(event.CloudTrailEvent);
  const action = event.EventName ?? '';
  return {
    id: event.EventId ?? '',
    occurredAt: (event.EventTime ?? new Date(0)).toISOString(),
    actor: actorOf(record.userIdentity, event.Username),
    action,
    label: actionLabel(action),
    resource: event.Resources?.[0]?.ResourceName ?? null,
    region: record.awsRegion ?? region,
    sourceIp: record.sourceIPAddress ?? null,
    errorCode: record.errorCode ?? null,
    viaDashboard: record.userIdentity?.accessKeyId === keyId,
  };
};

const lookupAttribute = ({ resource, actor, action, includeReads }: ActivityQuery): LookupAttribute[] => {
  if (resource) {
    return [{ AttributeKey: 'ResourceName', AttributeValue: resource }];
  }
  if (actor) {
    return [{ AttributeKey: 'Username', AttributeValue: actor }];
  }
  if (action) {
    return [{ AttributeKey: 'EventName', AttributeValue: action }];
  }
  return includeReads ? [] : [{ AttributeKey: 'ReadOnly', AttributeValue: 'false' }];
};

const contains = (value: string | null, search: string | undefined): boolean =>
  !search || (value ?? '').toLowerCase().includes(search.toLowerCase());

const matches = (event: CloudActivityEvent, query: ActivityQuery): boolean =>
  contains(event.actor, query.actor) && contains(event.action, query.action);

const readRegion = async (
  credentials: AwsKey,
  region: string,
  query: ActivityQuery,
): Promise<CloudActivityEvent[]> => {
  const { Events = [] } = await new CloudTrailClient({ region, credentials }).send(
    new LookupEventsCommand({
      LookupAttributes: lookupAttribute(query),
      EndTime: query.before,
      MaxResults: PAGE_SIZE,
    }),
  );
  return Events.map((event) => toActivity(event, region, credentials.accessKeyId));
};

export const AWS_ACTIVITY_SOURCE: ActivitySource<AwsKey> = {
  read: async ({ credentials, regions }, query) => {
    const events: CloudActivityEvent[] = [];
    for (const region of new Set([...regions, GLOBAL_REGION])) {
      events.push(...(await readRegion(credentials, region, query)));
    }
    const unique = new Map(events.map((event) => [event.id, event]));
    const newest = [...unique.values()]
      .sort((first, second) => second.occurredAt.localeCompare(first.occurredAt))
      .slice(0, PAGE_SIZE);
    return {
      events: newest.filter((event) => matches(event, query)),
      before: newest.length === PAGE_SIZE ? (newest.at(-1)?.occurredAt ?? null) : null,
    };
  },
};
