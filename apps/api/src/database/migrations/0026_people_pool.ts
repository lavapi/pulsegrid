import { type Kysely, sql } from 'kysely';

const ACROSS_PROJECTS = ['users', 'roles'] as const;

const setForced = async (db: Kysely<unknown>, forced: boolean): Promise<void> => {
  for (const table of ACROSS_PROJECTS) {
    await sql`alter table ${sql.table(table)} ${sql.raw(forced ? 'force' : 'no force')} row level security`.execute(db);
  }
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await setForced(db, false);
  await sql`
    alter table accounts
      add column display_name text,
      add column is_super_admin boolean not null default false,
      add column last_tenant_id uuid references tenants (id) on delete set null
  `.execute(db);
  await sql`
    update accounts set
      last_tenant_id = accounts.tenant_id,
      display_name = coalesce(
        (select display_name from users where users.account_id = accounts.id order by last_login_at desc limit 1),
        accounts.email
      )
  `.execute(db);
  await sql`alter table accounts alter column display_name set not null`.execute(db);
  await sql`
    update accounts set is_super_admin = true
    where id = (
      select users.account_id from users
      join tenants on tenants.id = users.tenant_id
      where users.is_owner and users.account_id is not null
      order by tenants.created_at
      limit 1
    )
  `.execute(db);
  await sql`create unique index accounts_super_admin_key on accounts (is_super_admin) where is_super_admin`.execute(db);
  await sql`alter table accounts drop column tenant_id`.execute(db);

  await sql`delete from users where account_id is null`.execute(db);
  await sql`
    insert into users (tenant_id, account_id, role_id, email, display_name, last_login_at)
    select tenants.id, accounts.id, roles.id, accounts.email, accounts.display_name, now()
    from tenants
    cross join accounts
    join roles on roles.tenant_id = tenants.id and roles.name = 'Admin'
    where accounts.is_super_admin
      and not exists (
        select 1 from users where users.tenant_id = tenants.id and users.account_id = accounts.id
      )
  `.execute(db);
  await sql`drop index users_owner_key`.execute(db);
  await sql`alter table users drop column is_owner`.execute(db);
  await sql`alter table users drop constraint users_account_id_fkey`.execute(db);
  await sql`
    alter table users
      alter column account_id set not null,
      add constraint users_account_id_fkey foreign key (account_id) references accounts (id) on delete cascade,
      add constraint users_tenant_account_key unique (tenant_id, account_id)
  `.execute(db);

  await sql`drop policy tenant_isolation on sessions`.execute(db);
  await sql`alter table sessions no force row level security`.execute(db);
  await sql`alter table sessions disable row level security`.execute(db);
  await sql`alter table sessions add column account_id uuid references accounts (id) on delete cascade`.execute(db);
  await sql`update sessions set account_id = users.account_id from users where users.id = sessions.user_id`.execute(db);
  await sql`delete from sessions where account_id is null`.execute(db);
  await sql`
    alter table sessions
      alter column account_id set not null,
      alter column tenant_id drop not null,
      drop column user_id
  `.execute(db);
  await sql`create index sessions_account_idx on sessions (account_id)`.execute(db);
  await sql`grant update on sessions to devdash_app`.execute(db);

  await setForced(db, true);
};

export const down = (): Promise<void> =>
  Promise.reject(new Error('Projects with a shared people pool cannot be undone.'));
