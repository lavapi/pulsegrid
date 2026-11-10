import type { Project, ProjectList } from '@pulsegrid/shared';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { AuditService } from '../audit/audit.service';
import { AccountStore } from '../auth/account-store';
import type { AuthContext, PersonContext } from '../auth/session/auth-context';
import { SessionService } from '../auth/session/session.service';
import { DATABASE } from '../database/database.module';
import type { Account, Database } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database';
import { ProjectDirectory } from '../tenants/project-directory';
import { createProject } from '../tenants/project-setup';

const PROJECT_MISSING = "That project doesn't exist, or you're not in it.";
const NO_ACCOUNT = 'We could not find your account.';
const NAME_MISMATCH = "The name you typed doesn't match this project.";
const LAST_PROJECT = "You can't delete the only project. Create another one first.";

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly accounts: AccountStore,
    private readonly directory: ProjectDirectory,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly database: TenantDatabase,
  ) {}

  async list(person: PersonContext): Promise<ProjectList> {
    return {
      currentId: person.project?.tenantId ?? null,
      projects: await this.directory.projectsOf(await this.accountOf(person)),
    };
  }

  async select(person: PersonContext, tenantId: string): Promise<void> {
    if (!(await this.directory.enter(await this.accountOf(person), tenantId))) {
      throw new NotFoundException(PROJECT_MISSING);
    }
    await this.sessions.select(person.sessionId, tenantId);
    await this.directory.remember(person.accountId, tenantId);
  }

  async create(person: PersonContext, name: string, ipAddress: string | undefined): Promise<Project> {
    const account = await this.accountOf(person);
    const { tenant } = await this.db.transaction().execute(async (trx) => {
      const created = await createProject(trx, name, account);
      await this.audit.record(trx, {
        tenantId: created.tenant.id,
        action: 'project.created',
        actor: { userId: created.userId, email: account.email },
        ipAddress,
        metadata: { label: name },
      });
      return created;
    });
    await this.select(person, tenant.id);
    return { id: tenant.id, name: tenant.name };
  }

  async rename(auth: AuthContext, name: string, ipAddress: string | undefined): Promise<Project> {
    const previous = await this.nameOf(auth.tenantId);
    await this.database.run(auth.tenantId, (trx) => sql`select rename_project(${auth.tenantId}, ${name})`.execute(trx));
    await this.record(auth.tenantId, auth, 'project.renamed', ipAddress, { label: name, previous });
    return { id: auth.tenantId, name };
  }

  async remove(auth: AuthContext, confirmName: string, ipAddress: string | undefined): Promise<void> {
    const name = await this.nameOf(auth.tenantId);
    if (confirmName.trim() !== name) {
      throw new BadRequestException(NAME_MISMATCH);
    }
    if ((await this.directory.all()).length <= 1) {
      throw new ConflictException(LAST_PROJECT);
    }
    await this.database.run(auth.tenantId, (trx) => sql`select delete_project(${auth.tenantId})`.execute(trx));
    const account = await this.accountOf(auth);
    const next = await this.directory.landing(account);
    await this.sessions.select(auth.sessionId, next);
    await this.directory.remember(account.id, next);
    if (next) {
      const userId = await this.database.run(next, async (trx) =>
        (await trx.selectFrom('users').select('id').where('account_id', '=', account.id).executeTakeFirstOrThrow()).id,
      );
      await this.record(next, { ...auth, userId }, 'project.deleted', ipAddress, { label: name });
    }
  }

  private async nameOf(tenantId: string): Promise<string> {
    const tenant = await this.db.selectFrom('tenants').select('name').where('id', '=', tenantId).executeTakeFirst();
    if (!tenant) {
      throw new NotFoundException(PROJECT_MISSING);
    }
    return tenant.name;
  }

  private record(
    tenantId: string,
    actor: { userId: string; email: string },
    action: string,
    ipAddress: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.database.run(tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId,
        action,
        actor: { userId: actor.userId, email: actor.email },
        target: { type: 'project', id: tenantId },
        ipAddress,
        metadata,
      }),
    );
  }

  private async accountOf({ accountId }: Pick<PersonContext, 'accountId'>): Promise<Account> {
    const account = await this.accounts.findById(accountId);
    if (!account) {
      throw new NotFoundException(NO_ACCOUNT);
    }
    return account;
  }
}
