import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table git_connections (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      provider text not null,
      name text not null,
      organization text not null,
      encrypted_credentials text not null,
      credential_hint text not null,
      status text not null default 'connected' check (status in ('connected', 'error')),
      last_error text,
      created_at timestamptz not null default now(),
      unique (tenant_id, provider, organization)
    )
  `.execute(db);
  await enableTenantIsolation(db, 'git_connections');
  await sql`grant select, insert, update, delete on git_connections to devdash_app`.execute(db);

  await sql`
    alter table pipeline_apps
      add column connection_id uuid references git_connections (id) on delete set null,
      drop constraint pipeline_apps_tenant_id_repository_key,
      add unique (tenant_id, connection_id, repository)
  `.execute(db);

  await sql`
    alter table pipeline_links
      add column app_id uuid references pipeline_apps (id) on delete cascade
  `.execute(db);
  await sql`
    update pipeline_links link set app_id = app.id
    from pipeline_apps app
    where app.tenant_id = link.tenant_id and app.repository = link.repository
  `.execute(db);
  await sql`delete from pipeline_links where app_id is null`.execute(db);
  await sql`
    alter table pipeline_links
      drop constraint pipeline_links_pkey,
      drop column repository,
      alter column app_id set not null,
      add primary key (app_id, workflow_id)
  `.execute(db);
};

export const down = (): Promise<void> =>
  Promise.reject(new Error('Git connections cannot be removed automatically.'));
