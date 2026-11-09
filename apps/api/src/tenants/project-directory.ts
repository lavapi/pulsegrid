import type { Project } from '@pulsegrid/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Account, Database } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database';
import { addSeat } from './project-setup';

export type ProjectPerson = Pick<Account, 'id' | 'email' | 'display_name' | 'is_super_admin' | 'last_tenant_id'>;

export interface Membership {
  accountId: string;
  roleName: string;
}

@Injectable()
export class ProjectDirectory {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
  ) {}

  all(): Promise<Project[]> {
    return this.db.selectFrom('tenants').select(['id', 'name']).orderBy('created_at').execute();
  }

  async projectsOf(person: ProjectPerson): Promise<Project[]> {
    const projects = await this.all();
    if (person.is_super_admin) {
      return projects;
    }
    const allowed = await Promise.all(projects.map(({ id }) => this.isMember(id, person.id)));
    return projects.filter((_, index) => allowed[index]);
  }

  async membersByProject(): Promise<{ project: Project; members: Membership[] }[]> {
    return Promise.all(
      (await this.all()).map(async (project) => ({
        project,
        members: await this.database.run(project.id, (trx) =>
          trx
            .selectFrom('users')
            .innerJoin('roles', 'roles.id', 'users.role_id')
            .select(['users.account_id as accountId', 'roles.name as roleName'])
            .execute(),
        ),
      })),
    );
  }

  async enter(person: ProjectPerson, tenantId: string): Promise<boolean> {
    const exists = await this.db.selectFrom('tenants').select('id').where('id', '=', tenantId).executeTakeFirst();
    if (!exists) {
      return false;
    }
    if (person.is_super_admin) {
      await this.database.run(tenantId, (trx) => addSeat(trx, tenantId, person));
      return true;
    }
    return this.isMember(tenantId, person.id);
  }

  async landing(person: ProjectPerson): Promise<string | null> {
    if (person.last_tenant_id && (await this.enter(person, person.last_tenant_id))) {
      return person.last_tenant_id;
    }
    const [first] = await this.projectsOf(person);
    if (first && (await this.enter(person, first.id))) {
      return first.id;
    }
    return null;
  }

  async seatEverywhere(person: ProjectPerson): Promise<void> {
    for (const { id } of await this.all()) {
      await this.database.run(id, (trx) => addSeat(trx, id, person));
    }
  }

  async leaveEverywhere(accountId: string): Promise<void> {
    for (const { id } of await this.all()) {
      await this.database.run(id, (trx) => trx.deleteFrom('users').where('account_id', '=', accountId).execute());
    }
  }

  async remember(accountId: string, tenantId: string | null): Promise<void> {
    await this.db.updateTable('accounts').set({ last_tenant_id: tenantId }).where('id', '=', accountId).execute();
  }

  private async isMember(tenantId: string, accountId: string): Promise<boolean> {
    const row = await this.database.run(tenantId, (trx) =>
      trx.selectFrom('users').select('id').where('account_id', '=', accountId).executeTakeFirst(),
    );
    return Boolean(row);
  }
}
