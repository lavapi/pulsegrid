import type { AuditEvent } from '@pulsegrid/shared';

const ACTION_LABELS: Record<string, string> = {
  'auth.sign_in.succeeded': 'Signed in',
  'auth.sign_in.failed': 'Sign-in failed',
  'auth.two_factor.failed': 'Two-factor code refused',
  'auth.workspace_created': 'Project created at setup',
  'project.created': 'Project created',
  'project.renamed': 'Project renamed',
  'project.deleted': 'Project deleted',
  'people.added': 'Person added',
  'people.removed': 'Person removed',
  'auth.password_reset': 'Password reset',
  'auth.password_changed': 'Password changed',
  'auth.temporary_password_replaced': 'Temporary password replaced',
  'auth.two_factor_enabled': 'Two-factor turned on',
  'auth.two_factor_disabled': 'Two-factor turned off',
  'team.role_created': 'Role created',
  'team.role_updated': 'Role changed',
  'team.role_deleted': 'Role deleted',
  'auth.signed_out_elsewhere': 'Signed out other devices',
  'team.member_added': 'Added to project',
  'team.permissions_changed': 'Permissions changed',
  'cloud.action.started': 'Cloud action started',
  'cloud.action.completed': 'Cloud action finished',
  'cloud.action.failed': 'Cloud action failed',
  'cloud.action.timed_out': 'Cloud action timed out',
  'cloud.action.unconfirmed': 'Cloud action not confirmed',
  'cloud.experiment.started': 'Failover test started',
  'cloud.experiment-run.started': 'Failover tests started together',
  'cloud.experiment-run.stopped': 'Failover tests stopped together',
  'cloud.experiment-group.created': 'Test group created',
  'cloud.experiment-group.updated': 'Test group changed',
  'cloud.experiment-group.deleted': 'Test group deleted',
  'cloud.experiment.stopped': 'Failover test stopped',
  'cloud.activity.detected': 'Outside activity detected',
  'cloud.activity.succeeded': 'Outside activity finished',
  'cloud.activity.failed': 'Outside activity failed',
  'cloud.activity.timed_out': 'Outside activity stopped reporting',
  'secret.value_read': 'Secret value shown',
  'secret.key_saved': 'Secret saved',
  'secret.key_deleted': 'Secret key deleted',
  'logs.viewed': 'Service logs viewed',
  'team.role_changed': 'Role changed',
  'team.member_removed': 'Removed from project',
  'team.ownership_transferred': 'Super admin changed',
  'team.temporary_password_set': 'Temporary password set',
  'auth.signed_out': 'Signed out',
  'access.denied': 'Permission denied',
  'pipeline.run_started': 'Pipeline started',
  'pipeline.rerun': 'Pipeline re-run',
  'pipeline.cancelled': 'Pipeline cancelled',
  'pipeline.action_denied': 'Pipeline action refused',
  'pipeline.environment_linked': 'Pipeline linked to environment',
  'pipeline.app_created': 'App created',
  'pipeline.release_linked': 'Pipeline linked to a service',
  'pipeline.release_unlinked': 'Pipeline unlinked from a service',
  'git.connection.added': 'Git connection added',
  'git.connection.removed': 'Git connection removed',
  'git.connection.credentials_replaced': 'Git credentials replaced',
  'cloud.account.added': 'Cloud account added',
  'cloud.account.removed': 'Cloud account removed',
  'cloud.account.updated': 'Cloud account changed',
  'cloud.account.credentials_replaced': 'Cloud credentials replaced',
  'cloud.account.sync_requested': 'Cloud account sync requested',
  'pipeline.app_deleted': 'App deleted',
  'environment.created': 'Environment created',
  'environment.renamed': 'Environment renamed',
  'environment.removed': 'Environment removed',
  'environment.account_assigned': 'Account assigned to environment',
  'environment.domain_added': 'Domain added',
  'environment.domain_updated': 'Domain changed',
  'environment.domain_removed': 'Domain removed',
  'aws.account.added': 'AWS account added',
  'aws.account.connected': 'AWS account connected',
  'aws.account.removed': 'AWS account removed',
  'aws.account.sync_requested': 'AWS sync requested',
};

const listed = (label: string, keys: unknown): string | null =>
  Array.isArray(keys) && keys.length > 0 ? `${label} ${keys.join(', ')}` : null;

const keyDetails = ({ key, previousKey, added, changed, removed }: AuditEvent['metadata']): string => {
  if (typeof key === 'string') {
    return typeof previousKey === 'string' ? `${previousKey} renamed to ${key}` : key;
  }
  return [listed('added', added), listed('changed', changed), listed('removed', removed)]
    .filter(Boolean)
    .join(', ');
};

const targetOf = ({ label, role, path }: AuditEvent['metadata']): string => {
  if (typeof label === 'string') {
    return typeof role === 'string' ? `${label} (${role})` : label;
  }
  return typeof path === 'string' ? path : '';
};

export const activityLabel = ({ action }: AuditEvent): string => ACTION_LABELS[action] ?? action;

export const activityDetails = ({ metadata }: AuditEvent): string =>
  [targetOf(metadata), keyDetails(metadata)].filter(Boolean).join(': ');
