import { type Kysely, type Migration, Migrator, sql } from 'kysely';
import * as foundation from './migrations/0001_foundation';
import * as awsInventory from './migrations/0002_aws_inventory';
import * as awsConnections from './migrations/0003_aws_connections';
import * as servicePermissions from './migrations/0004_service_permissions';
import * as environments from './migrations/0005_environments';
import * as pipelineLinks from './migrations/0006_pipeline_links';
import * as pipelineApps from './migrations/0007_pipeline_apps';
import * as awsAccessKeys from './migrations/0008_aws_access_keys';
import * as cloudAccounts from './migrations/0009_cloud_accounts';
import * as gitConnections from './migrations/0010_git_connections';
import * as ownAuth from './migrations/0011_own_auth';
import * as workspaceOwner from './migrations/0012_workspace_owner';
import * as ownerManagedAccounts from './migrations/0013_owner_managed_accounts';
import * as removeInvitations from './migrations/0014_remove_invitations';
import * as userPermissions from './migrations/0015_user_permissions';
import * as actionRuns from './migrations/0016_action_runs';
import * as outsideActivity from './migrations/0017_outside_activity';
import * as eventQueues from './migrations/0018_event_queues';
import * as removeEventQueues from './migrations/0019_remove_event_queues';
import * as tagFilters from './migrations/0020_tag_filters';
import * as customRoles from './migrations/0021_custom_roles';
import * as cloudCosts from './migrations/0022_cloud_costs';
import * as releaseTargets from './migrations/0023_release_targets';
import * as environmentDomains from './migrations/0024_environment_domains';
import * as environmentDomainUpdates from './migrations/0025_environment_domain_updates';
import * as peoplePool from './migrations/0026_people_pool';
import * as projectSettings from './migrations/0027_project_settings';
import * as productionEnvironments from './migrations/0028_production_environments';
import * as projectFunctionChecks from './migrations/0029_project_function_checks';
import * as twoFactorAttempts from './migrations/0030_two_factor_attempts';
import * as experimentGroups from './migrations/0031_experiment_groups';

const MIGRATIONS: Record<string, Migration> = {
  '0001_foundation': foundation,
  '0002_aws_inventory': awsInventory,
  '0003_aws_connections': awsConnections,
  '0004_service_permissions': servicePermissions,
  '0005_environments': environments,
  '0006_pipeline_links': pipelineLinks,
  '0007_pipeline_apps': pipelineApps,
  '0008_aws_access_keys': awsAccessKeys,
  '0009_cloud_accounts': cloudAccounts,
  '0010_git_connections': gitConnections,
  '0011_own_auth': ownAuth,
  '0012_workspace_owner': workspaceOwner,
  '0013_owner_managed_accounts': ownerManagedAccounts,
  '0014_remove_invitations': removeInvitations,
  '0015_user_permissions': userPermissions,
  '0016_action_runs': actionRuns,
  '0017_outside_activity': outsideActivity,
  '0018_event_queues': eventQueues,
  '0019_remove_event_queues': removeEventQueues,
  '0020_tag_filters': tagFilters,
  '0021_custom_roles': customRoles,
  '0022_cloud_costs': cloudCosts,
  '0023_release_targets': releaseTargets,
  '0024_environment_domains': environmentDomains,
  '0025_environment_domain_updates': environmentDomainUpdates,
  '0026_people_pool': peoplePool,
  '0027_project_settings': projectSettings,
  '0028_production_environments': productionEnvironments,
  '0029_project_function_checks': projectFunctionChecks,
  '0030_two_factor_attempts': twoFactorAttempts,
  '0031_experiment_groups': experimentGroups,
};

const ensureAppRole = async (db: Kysely<unknown>, password: string): Promise<void> => {
  await sql`
    do $$ begin
      if not exists (select from pg_roles where rolname = 'devdash_app') then
        create role devdash_app login nosuperuser nobypassrls;
      end if;
    end $$
  `.execute(db);
  const { rows } = await sql<{ statement: string }>`
    select format('alter role devdash_app password %L', ${password}::text) as statement
  `.execute(db);
  await sql.raw(rows[0]!.statement).execute(db);
};

export const migratorFor = (db: Kysely<any>): Migrator =>
  new Migrator({ db, provider: { getMigrations: () => Promise.resolve(MIGRATIONS) } });

export const runMigrations = async (db: Kysely<any>, appRolePassword: string): Promise<void> => {
  await ensureAppRole(db, appRolePassword);
  const { error } = await migratorFor(db).migrateToLatest();
  if (error) {
    throw error;
  }
};
