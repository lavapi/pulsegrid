import type {
  CloudActivityEvent,
  CloudPermission,
  CredentialCheck,
  InfrastructureMap,
  LogLine,
  Resource,
  ResourceHealth,
  ResourceType,
} from '@pulsegrid/shared';

export const GLOBAL_REGION = 'global';

export type CloudCredentials = Record<string, string>;

export type MapResource = Pick<
  Resource,
  'id' | 'type' | 'nativeId' | 'name' | 'status' | 'health' | 'region' | 'details'
>;

export interface CollectedResource {
  type: ResourceType;
  region: string;
  nativeId: string;
  name: string;
  status: string;
  health: ResourceHealth;
  tags: Record<string, string>;
  details: Record<string, unknown>;
}

export interface CollectorContext<Credentials extends CloudCredentials = CloudCredentials> {
  credentials: Credentials;
  region: string;
}

export interface ResourceCollector<Credentials extends CloudCredentials = CloudCredentials> {
  name: string;
  label: string;
  scope: 'regional' | 'global';
  types: readonly ResourceType[];
  collect(context: CollectorContext<Credentials>): Promise<CollectedResource[]>;
}

export interface ResourceActionContext<Credentials extends CloudCredentials = CloudCredentials> {
  credentials: Credentials;
  region: string;
  resource: { nativeId: string; name: string; details: Record<string, unknown> };
}

export interface ActionTrackingContext<Credentials extends CloudCredentials = CloudCredentials>
  extends ResourceActionContext<Credentials> {
  trackingId: string | null;
  startedAt: Date;
}

export interface ActionStart {
  trackingId: string | null;
  summary: string;
}

export interface ActionProgress {
  state: 'running' | 'succeeded' | 'failed' | 'unconfirmed';
  summary: string;
}

export interface ResourceAction<Credentials extends CloudCredentials = CloudCredentials> {
  permission: CloudPermission;
  resourceType: ResourceType;
  timeoutMinutes: number;
  run(context: ResourceActionContext<Credentials>): Promise<ActionStart>;
  track(context: ActionTrackingContext<Credentials>): Promise<ActionProgress>;
}

export interface DetectedActivity {
  resourceType: ResourceType;
  nativeId: string;
  title: string;
  summary: string;
  failed: boolean;
}

export interface ActivityWatch<Credentials extends CloudCredentials = CloudCredentials> {
  types: readonly ResourceType[];
  detect(context: { credentials: Credentials; region: string }): Promise<DetectedActivity[]>;
}

export interface SecretContext<Credentials extends CloudCredentials = CloudCredentials> {
  credentials: Credentials;
  region: string;
  secretId: string;
}

export interface StoredSecret {
  value: string | null;
  versionId: string;
}

export interface SecretStore<Credentials extends CloudCredentials = CloudCredentials> {
  resourceType: ResourceType;
  read(context: SecretContext<Credentials>): Promise<StoredSecret>;
  write(context: SecretContext<Credentials>, value: string): Promise<void>;
}

export interface ActivityQuery {
  before?: Date | undefined;
  actor?: string | undefined;
  action?: string | undefined;
  resource?: string | undefined;
  includeReads?: boolean | undefined;
}

export interface ActivityResult {
  events: CloudActivityEvent[];
  before: string | null;
}

export interface ActivitySource<Credentials extends CloudCredentials = CloudCredentials> {
  read(
    context: { credentials: Credentials; regions: readonly string[] },
    query: ActivityQuery,
  ): Promise<ActivityResult>;
}

export interface LogContext<Credentials extends CloudCredentials = CloudCredentials> {
  credentials: Credentials;
  region: string;
  resource: { nativeId: string; name: string; details: Record<string, unknown> };
}

export interface LogQuery {
  since: Date;
  until: Date;
  search?: string | undefined;
}

export interface LogResult {
  available: boolean;
  lines: LogLine[];
}

export interface LogSource<Credentials extends CloudCredentials = CloudCredentials> {
  resourceType: ResourceType;
  read(context: LogContext<Credentials>, query: LogQuery): Promise<LogResult>;
}

export interface CostContext<Credentials extends CloudCredentials = CloudCredentials> {
  credentials: Credentials;
  accountId: string;
}

export interface CostPeriod {
  from: Date;
  until: Date;
}

export interface CostEntry {
  month: string;
  service: string;
  category: string | null;
  amount: number;
  currency: string;
}

export interface CostSource<Credentials extends CloudCredentials = CloudCredentials> {
  read(context: CostContext<Credentials>, period: CostPeriod): Promise<CostEntry[]>;
  failureMessage(error: unknown): string;
}

export type DeploymentState = 'running' | 'succeeded' | 'failed';

export interface Deployment {
  state: DeploymentState;
  startedAt: string | null;
  finishedAt: string | null;
  runningTasks: number;
  desiredTasks: number;
  images: string[];
  targetLabel: string;
}

export interface DeploymentSource<Credentials extends CloudCredentials = CloudCredentials> {
  resourceType: ResourceType;
  read(context: ResourceActionContext<Credentials>): Promise<Deployment | null>;
}

export class CredentialsRejected extends Error {}

export interface CloudProvider<Credentials extends CloudCredentials = CloudCredentials> {
  id: string;
  collectors: readonly ResourceCollector<Credentials>[];
  unfilteredTypes: readonly ResourceType[];
  actions: readonly ResourceAction<Credentials>[];
  activityWatches: readonly ActivityWatch<Credentials>[];
  secretStore?: SecretStore<Credentials>;
  activitySource?: ActivitySource<Credentials>;
  logSource?: LogSource<Credentials>;
  costSource?: CostSource<Credentials>;
  deploymentSource?: DeploymentSource<Credentials>;
  parseCredentials(input: unknown): Credentials | null;
  credentialHint(credentials: Credentials): string;
  isValidRegion(region: string): boolean;
  checkCredentials(credentials: Credentials, region: string): Promise<CredentialCheck>;
  failureMessage(error: unknown, label: string): string;
  actionFailureMessage(error: unknown): string;
  buildMap(resources: readonly MapResource[]): InfrastructureMap;
}

export const defineProvider = <Credentials extends CloudCredentials>(
  provider: CloudProvider<Credentials>,
): CloudProvider => provider as unknown as CloudProvider;

export const CLOUD_PROVIDER_LIST = Symbol('CLOUD_PROVIDER_LIST');
