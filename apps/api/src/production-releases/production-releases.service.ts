import type {
  ProductionRelease,
  ProductionReleaseChoice,
  ProductionReleaseDecisionResult,
  ProductionReleasesView,
} from '@pulsegrid/shared';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/session/auth-context';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database';
import { MESSAGES, ProductionReleaseError, refusalMessage } from './production-releases-errors';
import { ProductionReleasesAws } from './production-releases.aws';
import { PRODUCTION_RELEASES_SETUP, type ProductionReleasesSetup } from './production-releases.settings';
import { ACTIVE_ID, activeReleaseId, newestFirst, toRelease } from './release-records';

const HISTORY_SIZE = 20;
const WAITING = 'HOLD';

const DECISIONS = { finish: 'FINISH', rollback: 'ROLLBACK' } as const;
const ACTIONS = { finish: 'production.release.finished', rollback: 'production.release.rolled_back' } as const;
const FAILED_ACTION = 'production.release.decision_failed';

/** Why a decision can't be made on this release, or null when it is waiting for one. */
const refusalFor = (release: ProductionRelease | null): string | null => {
  if (!release) return MESSAGES.noRelease;
  if (release.decision) return MESSAGES.alreadyDecided(release.decidedBy);
  return release.status === WAITING ? null : MESSAGES.notWaiting;
};

/** Production releases waiting in their hold, and the person who finishes or rolls one back. */
@Injectable()
export class ProductionReleasesService {
  private readonly logger = new Logger(ProductionReleasesService.name);

  constructor(
    private readonly aws: ProductionReleasesAws,
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    @Inject(PRODUCTION_RELEASES_SETUP) private readonly setup: ProductionReleasesSetup,
  ) {}

  async view(auth: AuthContext): Promise<ProductionReleasesView> {
    if (!(await this.shownIn(auth.tenantId))) {
      return { ready: false };
    }
    return { ready: true, current: await this.reading(() => this.current()) };
  }

  /** 1 while a release waits for a decision, for the badge beside the menu entry. */
  async waiting(auth: AuthContext): Promise<{ count: number }> {
    if (!(await this.shownIn(auth.tenantId))) {
      return { count: 0 };
    }
    const current = await this.current().catch(() => null);
    return { count: current?.status === WAITING && !current.decision ? 1 : 0 };
  }

  async history(auth: AuthContext): Promise<ProductionRelease[]> {
    await this.requireShown(auth);
    return this.reading(async () => {
      const releases = (await this.aws.allItems()).filter((item) => item['id']?.S !== ACTIVE_ID).map(toRelease);
      return newestFirst(releases, HISTORY_SIZE);
    });
  }

  async decide(
    auth: AuthContext,
    choice: ProductionReleaseChoice,
    ipAddress: string | undefined,
  ): Promise<ProductionReleaseDecisionResult> {
    await this.requireShown(auth);
    const release = await this.reading(() => this.current());
    const refusal = refusalFor(release);
    if (refusal || !release) {
      await this.record(auth, FAILED_ACTION, release?.id ?? null, choice, ipAddress, refusal ?? MESSAGES.noRelease);
      throw new ConflictException(refusal ?? MESSAGES.noRelease);
    }

    const outcome = await this.aws.decide(choice, auth.email).catch((error: unknown) => {
      this.logger.warn(`Deciding release ${release.id} failed: ${error instanceof Error ? error.name : 'unknown error'}`);
      return null;
    });
    if (!outcome?.accepted) {
      const message = outcome ? refusalMessage(outcome.refusal) : MESSAGES.cantDecide;
      await this.record(auth, FAILED_ACTION, release.id, choice, ipAddress, message);
      throw outcome ? new ConflictException(message) : new ServiceUnavailableException(message);
    }

    await this.record(auth, ACTIONS[choice], release.id, choice, ipAddress, 'succeeded');
    this.logger.log(`${auth.email} chose ${DECISIONS[choice]} for release ${release.id}`);
    return { releaseId: release.id, decision: DECISIONS[choice], decidedBy: auth.email };
  }

  private async current(): Promise<ProductionRelease | null> {
    const id = activeReleaseId(await this.aws.item(ACTIVE_ID));
    const item = id ? await this.aws.item(id) : undefined;
    return item ? toRelease(item) : null;
  }

  /** Reads from production, turning any AWS failure into a readable message and logging only its kind. */
  private async reading<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof ProductionReleaseError) {
        throw new NotFoundException(error.message);
      }
      this.logger.warn(`Reading production releases failed: ${error instanceof Error ? error.name : 'unknown error'}`);
      throw new ServiceUnavailableException(MESSAGES.cantRead);
    }
  }

  private async shownIn(tenantId: string): Promise<boolean> {
    if (!this.setup) {
      return false;
    }
    const tenant = await this.db.selectFrom('tenants').select('slug').where('id', '=', tenantId).executeTakeFirst();
    return tenant?.slug === this.setup.projectSlug;
  }

  private async requireShown(auth: AuthContext): Promise<void> {
    if (!(await this.shownIn(auth.tenantId))) {
      throw new NotFoundException(MESSAGES.notSetUp);
    }
  }

  private record(
    auth: AuthContext,
    action: string,
    releaseId: string | null,
    choice: ProductionReleaseChoice,
    ipAddress: string | undefined,
    result: string,
  ): Promise<void> {
    return this.database.run(auth.tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId: auth.tenantId,
        action,
        actor: { userId: auth.userId, email: auth.email },
        target: { type: 'production_release', id: releaseId ?? 'none' },
        ipAddress,
        metadata: { decision: DECISIONS[choice], result },
      }),
    );
  }
}
