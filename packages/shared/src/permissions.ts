import { CLOUD_ACTIONS, CLOUD_PERMISSIONS, type CloudPermission } from './cloud-actions';

export const WORKSPACE_PERMISSIONS = {
  'activity.view': { label: 'View activity' },
  'costs.view': { label: 'View costs' },
  'accounts.sync': { label: 'Sync cloud accounts' },
  'pipeline.run': { label: 'Run pipelines' },
  'pipeline_apps.manage': { label: 'Manage pipeline apps' },
  'team.view': { label: 'View the team and roles' },
  'integrations.manage': { label: 'Manage integrations' },
  'environments.manage': { label: 'Manage environments' },
} as const;

export const DATA_PERMISSIONS = {
  'secret.read': { label: 'Read app secrets' },
  'secret.write': { label: 'Write app secrets' },
  'logs.read': { label: 'View service logs' },
} as const;

export type WorkspacePermission = keyof typeof WORKSPACE_PERMISSIONS;

export type DataPermission = keyof typeof DATA_PERMISSIONS;

export type UserPermission = CloudPermission | DataPermission | WorkspacePermission;

const LABELS: Record<UserPermission, { label: string }> = {
  ...CLOUD_ACTIONS,
  ...DATA_PERMISSIONS,
  ...WORKSPACE_PERMISSIONS,
};

export const PERMISSION_GROUPS: readonly { title: string; permissions: readonly UserPermission[] }[] = [
  { title: 'Workspace', permissions: Object.keys(WORKSPACE_PERMISSIONS) as WorkspacePermission[] },
  { title: 'Staging actions', permissions: CLOUD_PERMISSIONS },
  { title: 'Secrets and logs', permissions: Object.keys(DATA_PERMISSIONS) as DataPermission[] },
];

export const USER_PERMISSIONS: readonly UserPermission[] = PERMISSION_GROUPS.flatMap(
  ({ permissions }) => permissions,
);

export const isUserPermission = (value: string): value is UserPermission =>
  Object.hasOwn(LABELS, value);

export const permissionLabel = (permission: UserPermission): string => LABELS[permission].label;

export const hasPermission = (
  { permissions }: { permissions: readonly UserPermission[] },
  permission: UserPermission,
): boolean => permissions.includes(permission);
