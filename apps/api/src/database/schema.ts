import type {
  ActionRunStatus,
  CloudAccountStatus,
  DomainKind,
  ResourceHealth,
  ResourceType,
  SyncIssue,
  TagFilter,
} from '@pulsegrid/shared';
import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

type CreatedAt = ColumnType<Date, Date | undefined, never>;

export interface TenantsTable {
  id: Generated<string>;
  slug: string;
  name: string;
  created_at: CreatedAt;
}

export interface UsersTable {
  id: Generated<string>;
  tenant_id: string;
  account_id: string;
  role_id: string;
  email: string;
  display_name: string;
  created_at: CreatedAt;
  last_login_at: Date;
}

export interface SessionsTable {
  id: Generated<string>;
  account_id: string;
  tenant_id: string | null;
  token_hash: string;
  created_at: CreatedAt;
  expires_at: Date;
}

export interface AccountsTable {
  id: Generated<string>;
  email: string;
  display_name: string;
  is_super_admin: Generated<boolean>;
  last_tenant_id: string | null;
  password_hash: string | null;
  failed_attempts: Generated<number>;
  two_factor_failed_attempts: Generated<number>;
  locked_until: Date | null;
  totp_secret: string | null;
  totp_enabled_at: Date | null;
  totp_last_step: ColumnType<string | null, number | null | undefined, number | null>;
  backup_codes: Generated<string[]>;
  temporary_password_expires_at: Generated<Date | null>;
  created_at: CreatedAt;
}

export interface AccountIdentitiesTable {
  provider: string;
  subject: string;
  account_id: string;
  created_at: CreatedAt;
}

export interface RolesTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  created_at: CreatedAt;
}

export interface RolePermissionsTable {
  tenant_id: string;
  role_id: string;
  permission: string;
  created_at: CreatedAt;
}

export interface ActionRunsTable {
  id: Generated<string>;
  tenant_id: string;
  resource_id: string;
  permission: string | null;
  title: ColumnType<string | null, string | null | undefined, string | null>;
  status: ColumnType<ActionRunStatus, ActionRunStatus | undefined, ActionRunStatus>;
  summary: string;
  tracking_id: ColumnType<string | null, string | null | undefined, string | null>;
  started_by_user_id: string | null;
  started_by_email: string | null;
  started_at: ColumnType<Date, Date | undefined, never>;
  expires_at: Date;
  finished_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

export type ActionRunRow = Selectable<ActionRunsTable>;

export interface AuditEventsTable {
  id: Generated<string>;
  tenant_id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip_address: string | null;
  metadata: ColumnType<Record<string, unknown>, string, never>;
  occurred_at: CreatedAt;
}

type JsonColumn<T> = ColumnType<T, string, string>;


export interface EnvironmentsTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  sort_order: ColumnType<number, number | undefined, number>;
  created_at: CreatedAt;
}

export interface EnvironmentDomainsTable {
  id: Generated<string>;
  tenant_id: string;
  environment_id: string;
  kind: DomainKind;
  label: string | null;
  url: string;
  created_at: CreatedAt;
}

export interface PipelineLinksTable {
  tenant_id: string;
  app_id: string;
  workflow_id: string;
  environment_id: string | null;
}

export interface PipelineAppsTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  repository: string;
  connection_id: string | null;
  created_at: Generated<Date>;
}

export interface ReleaseTargetsTable {
  id: Generated<string>;
  tenant_id: string;
  app_id: string;
  workflow_id: string;
  cloud_account_id: string;
  native_id: string;
  service_name: string;
  created_at: CreatedAt;
}

export interface GitConnectionsTable {
  id: Generated<string>;
  tenant_id: string;
  provider: string;
  name: string;
  organization: string;
  encrypted_credentials: string;
  credential_hint: string;
  status: ColumnType<'connected' | 'error', 'connected' | 'error' | undefined, 'connected' | 'error'>;
  last_error: string | null;
  created_at: Generated<Date>;
}

export interface CloudAccountsTable {
  id: Generated<string>;
  tenant_id: string;
  account_id: string;
  name: string;
  regions: string[];
  status: ColumnType<CloudAccountStatus, CloudAccountStatus | undefined, CloudAccountStatus>;
  last_error: string | null;
  last_synced_at: Date | null;
  sync_issues: ColumnType<SyncIssue[], string | undefined, string>;
  tag_filter: ColumnType<TagFilter, string | undefined, string>;
  provider: string;
  encrypted_credentials: string | null;
  credential_hint: string | null;
  can_write: boolean | null;
  environment_id: string | null;
  environment_reviewed: ColumnType<boolean, boolean | undefined, boolean>;
  costs_checked_at: Date | null;
  costs_updated_at: Date | null;
  costs_error: string | null;
  created_at: CreatedAt;
}

export interface CloudCostsTable {
  tenant_id: string;
  cloud_account_id: string;
  month: string;
  service: string;
  category: string | null;
  amount: ColumnType<string, number, number>;
  currency: string;
}

export interface ResourcesTable {
  id: Generated<string>;
  tenant_id: string;
  cloud_account_id: string;
  region: string;
  type: ResourceType;
  service: string;
  native_id: string;
  name: string;
  status: string;
  health: ResourceHealth;
  tags: JsonColumn<Record<string, string>>;
  details: JsonColumn<Record<string, unknown>>;
  last_seen_at: Date;
}

export interface Database {
  tenants: TenantsTable;
  accounts: AccountsTable;
  account_identities: AccountIdentitiesTable;
  users: UsersTable;
  sessions: SessionsTable;
  audit_events: AuditEventsTable;
  cloud_accounts: CloudAccountsTable;
  cloud_costs: CloudCostsTable;
  resources: ResourcesTable;
  environments: EnvironmentsTable;
  environment_domains: EnvironmentDomainsTable;
  roles: RolesTable;
  role_permissions: RolePermissionsTable;
  action_runs: ActionRunsTable;
  pipeline_links: PipelineLinksTable;
  pipeline_apps: PipelineAppsTable;
  release_targets: ReleaseTargetsTable;
  git_connections: GitConnectionsTable;
}

export type Tenant = Selectable<TenantsTable>;
export type User = Selectable<UsersTable>;
export type Account = Selectable<AccountsTable>;
export type NewAuditEventRow = Insertable<AuditEventsTable>;
export type CloudAccountRow = Selectable<CloudAccountsTable>;
export type PipelineAppRow = Selectable<PipelineAppsTable>;
export type GitConnectionRow = Selectable<GitConnectionsTable>;
