import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

const DEVELOPER = ['activity.view', 'accounts.sync', 'pipeline.run', 'pipeline_apps.manage'];
const ADMIN = [...DEVELOPER, 'team.view', 'integrations.manage', 'environments.manage'];
const STARTING_ROLES: Record<string, { name: string; permissions: string[] }> = {
  admin: { name: 'Admin', permissions: ADMIN },
  developer: { name: 'Developer', permissions: DEVELOPER },
  viewer: { name: 'Viewer', permissions: [] },
};

const addRole = async (
  db: Kysely<unknown>,
  tenantId: string,
  name: string,
  permissions: string[],
): Promise<string> => {
  const { rows } = await sql<{ id: string }>`
    insert into roles (tenant_id, name) values (${tenantId}, ${name}) returning id
  `.execute(db);
  const id = rows[0]!.id;
  for (const permission of permissions) {
    await sql`
      insert into role_permissions (tenant_id, role_id, permission)
      values (${tenantId}, ${id}, ${permission})
    `.execute(db);
  }
  return id;
};

const moveTenant = async (db: Kysely<unknown>, tenantId: string): Promise<void> => {
  await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(db);
  for (const [oldRole, { name, permissions }] of Object.entries(STARTING_ROLES)) {
    const id = await addRole(db, tenantId, name, permissions);
    await sql`update users set role_id = ${id} where tenant_id = ${tenantId} and role = ${oldRole}`.execute(db);
  }

  const { rows: ticked } = await sql<{ id: string; role: string; extras: string[] }>`
    select users.id, users.role, array_agg(user_permissions.permission order by permission) as extras
    from user_permissions
    join users on users.id = user_permissions.user_id
    where users.tenant_id = ${tenantId} and not users.is_owner
    group by users.id, users.role
  `.execute(db);
  const created = new Map<string, string>();
  for (const { id, role, extras } of ticked) {
    const key = `${role}:${extras.join(',')}`;
    const starting = STARTING_ROLES[role]!;
    const roleId =
      created.get(key) ??
      (await addRole(db, tenantId, `${starting.name} custom ${created.size + 1}`, [
        ...new Set([...starting.permissions, ...extras]),
      ]));
    created.set(key, roleId);
    await sql`update users set role_id = ${roleId} where id = ${id}`.execute(db);
  }
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table roles (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      name text not null,
      created_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`create unique index roles_name_key on roles (tenant_id, lower(name))`.execute(db);
  await sql`
    create table role_permissions (
      tenant_id uuid not null references tenants (id) on delete cascade,
      role_id uuid not null references roles (id) on delete cascade,
      permission text not null,
      created_at timestamptz not null default now(),
      primary key (role_id, permission)
    )
  `.execute(db);
  await enableTenantIsolation(db, 'roles');
  await enableTenantIsolation(db, 'role_permissions');
  await sql`grant select, insert, update, delete on roles to devdash_app`.execute(db);
  await sql`grant select, insert, delete on role_permissions to devdash_app`.execute(db);

  await sql`alter table users add column role_id uuid references roles (id)`.execute(db);
  const { rows: tenants } = await sql<{ id: string }>`select id from tenants`.execute(db);
  for (const { id } of tenants) {
    await moveTenant(db, id);
  }
  await sql`select set_config('app.tenant_id', '', true)`.execute(db);
  await sql`alter table users alter column role_id set not null`.execute(db);
  await sql`create index users_role_id_idx on users (role_id)`.execute(db);
  await sql`alter table users drop column role`.execute(db);
  await sql`drop table user_permissions`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table user_permissions (
      tenant_id uuid not null references tenants (id) on delete cascade,
      user_id uuid not null references users (id) on delete cascade,
      permission text not null,
      created_at timestamptz not null default now(),
      primary key (user_id, permission)
    )
  `.execute(db);
  await enableTenantIsolation(db, 'user_permissions');
  await sql`grant select, insert, delete on user_permissions to devdash_app`.execute(db);
  await sql`
    alter table users add column role text not null default 'viewer'
    check (role in ('viewer', 'developer', 'admin'))
  `.execute(db);
  await sql`
    update users set role = case
      when exists (
        select from role_permissions
        where role_id = users.role_id and permission = 'integrations.manage'
      ) then 'admin'
      when exists (
        select from role_permissions
        where role_id = users.role_id and permission = 'pipeline.run'
      ) then 'developer'
      else 'viewer'
    end
  `.execute(db);
  await sql`
    insert into user_permissions (tenant_id, user_id, permission)
    select users.tenant_id, users.id, role_permissions.permission
    from users
    join role_permissions on role_permissions.role_id = users.role_id
    where role_permissions.permission in (
      'service.redeploy', 'database.reboot', 'cache.reboot', 'server.reboot',
      'secret.read', 'secret.write', 'logs.read'
    )
  `.execute(db);
  await sql`alter table users alter column role drop default`.execute(db);
  await sql`alter table users drop column role_id`.execute(db);
  await sql`drop table role_permissions`.execute(db);
  await sql`drop table roles`.execute(db);
};
