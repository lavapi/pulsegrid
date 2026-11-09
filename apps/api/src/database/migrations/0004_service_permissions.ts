import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table user_aws_accounts`.execute(db);

  await sql`
    create table user_aws_permissions (
      user_id uuid not null references users (id) on delete cascade,
      aws_account_id uuid not null references aws_accounts (id) on delete cascade,
      service text not null,
      level text not null check (level in ('manage', 'view', 'view_unknown', 'none')),
      role_name text,
      tenant_id uuid not null references tenants (id) on delete cascade,
      primary key (user_id, aws_account_id, service)
    )
  `.execute(db);
  await enableTenantIsolation(db, 'user_aws_permissions');
  await sql`grant select, insert, update, delete on user_aws_permissions to devdash_app`.execute(db);

  await sql`alter table aws_identity_settings drop column permission_set_name`.execute(db);
  await sql`
    alter table user_aws_connections rename column accounts_without_role to accounts_without_access
  `.execute(db);
  await sql`alter table user_aws_connections add column permissions_checked_at timestamptz`.execute(db);

  await sql`alter table resources add column service text`.execute(db);
  await sql`
    update resources set service = case
      when type like 'ecs-%' then 'ecs'
      when type like 'rds-%' then 'rds'
      when type like 'elasticache-%' then 'elasticache'
      when type = 's3-bucket' then 's3'
      when type = 'ec2-instance' then 'ec2'
      else 'network'
    end
  `.execute(db);
  await sql`alter table resources alter column service set not null`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table resources drop column service`.execute(db);
  await sql`alter table user_aws_connections drop column permissions_checked_at`.execute(db);
  await sql`
    alter table user_aws_connections rename column accounts_without_access to accounts_without_role
  `.execute(db);
  await sql`
    alter table aws_identity_settings add column permission_set_name text not null default 'DashOpsReadOnly'
  `.execute(db);
  await sql`drop table user_aws_permissions`.execute(db);
  await sql`
    create table user_aws_accounts (
      user_id uuid not null references users (id) on delete cascade,
      aws_account_id uuid not null references aws_accounts (id) on delete cascade,
      tenant_id uuid not null references tenants (id) on delete cascade,
      primary key (user_id, aws_account_id)
    )
  `.execute(db);
  await enableTenantIsolation(db, 'user_aws_accounts');
  await sql`grant select, insert, update, delete on user_aws_accounts to devdash_app`.execute(db);
};
