import { CLOUD_ACTIONS } from './cloud-actions';

export const WORKSPACE_PERMISSIONS = {
  'activity.view': { label: 'View activity' },
  'costs.view': { label: 'View costs' },
  'accounts.sync': { label: 'Sync cloud accounts' },
  'pipeline_apps.manage': { label: 'Manage pipeline apps' },
  'team.view': { label: 'View the team and roles' },
  'integrations.manage': { label: 'Manage integrations' },
  'environments.manage': { label: 'Manage environments' },
  'logs.read': { label: 'View logs' },
  'logs.sensitive': { label: 'See query strings and values in logs' },
} as const;

/** Permissions that act on an environment. Each is granted separately for staging and for production. */
export const STAGING_PERMISSIONS = {
  'pipeline.run': { label: 'Run staging pipelines', production: 'Run production pipelines' },
  ...CLOUD_ACTIONS,
  'secret.read': { label: 'Read staging app secrets', production: 'Read production app secrets' },
  'secret.write': { label: 'Write staging app secrets', production: 'Write production app secrets' },
} as const;

export type WorkspacePermission = keyof typeof WORKSPACE_PERMISSIONS;

export type StagingPermission = keyof typeof STAGING_PERMISSIONS;

export type ProductionPermission = `production.${StagingPermission}`;

export type UserPermission = WorkspacePermission | StagingPermission | ProductionPermission;

export const productionPermission = (permission: StagingPermission): ProductionPermission =>
  `production.${permission}`;

/** The permission needed in an environment: the staging one, or its production twin. */
export const permissionFor = (permission: StagingPermission, production: boolean): UserPermission =>
  production ? productionPermission(permission) : permission;

const STAGING_KEYS = Object.keys(STAGING_PERMISSIONS) as StagingPermission[];
const WORKSPACE_KEYS = Object.keys(WORKSPACE_PERMISSIONS) as WorkspacePermission[];

const LABELS = new Map<UserPermission, string>([
  ...WORKSPACE_KEYS.map((key) => [key, WORKSPACE_PERMISSIONS[key].label] as const),
  ...STAGING_KEYS.map((key) => [key, STAGING_PERMISSIONS[key].label] as const),
  ...STAGING_KEYS.map((key) => [productionPermission(key), STAGING_PERMISSIONS[key].production] as const),
]);

export const PERMISSION_GROUPS: readonly { title: string; permissions: readonly UserPermission[] }[] = [
  { title: 'Workspace', permissions: WORKSPACE_KEYS },
  { title: 'Staging', permissions: STAGING_KEYS },
  { title: 'Production', permissions: STAGING_KEYS.map(productionPermission) },
];

export const USER_PERMISSIONS: readonly UserPermission[] = PERMISSION_GROUPS.flatMap(
  ({ permissions }) => permissions,
);

export const isUserPermission = (value: string): value is UserPermission => LABELS.has(value as UserPermission);

export const permissionLabel = (permission: UserPermission): string => LABELS.get(permission) ?? permission;

export const hasPermission = (
  { permissions }: { permissions: readonly UserPermission[] },
  permission: UserPermission,
): boolean => permissions.includes(permission);
