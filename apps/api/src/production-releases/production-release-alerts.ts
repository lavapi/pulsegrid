import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/schema';
import { PushNotifier } from '../push/push-notifier';
import { REDIS } from '../redis/redis.module';
import { ProductionReleasesAws } from './production-releases.aws';
import { PRODUCTION_RELEASES_SETUP, type ProductionReleasesSetup } from './production-releases.settings';
import { isWaiting } from './release-records';

/** Long enough to outlast any hold, so a release is announced once. */
const ANNOUNCED_FOR_SECONDS = 3 * 24 * 60 * 60;

/** Tells the people who decide production releases, on their phones, when a release starts waiting for them. */
@Injectable()
export class ProductionReleaseAlerts {
  constructor(
    private readonly aws: ProductionReleasesAws,
    @Inject(PRODUCTION_RELEASES_SETUP) private readonly setup: ProductionReleasesSetup,
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly push: PushNotifier,
  ) {}

  get enabled(): boolean {
    return this.setup !== null;
  }

  async check(): Promise<void> {
    if (!this.setup) return;
    const release = await this.aws.current();
    if (!isWaiting(release)) return;
    const first = await this.redis.set(`production-release:announced:${release.id}`, '1', 'EX', ANNOUNCED_FOR_SECONDS, 'NX');
    if (first !== 'OK') return;
    const tenant = await this.db.selectFrom('tenants').select('id').where('slug', '=', this.setup.projectSlug).executeTakeFirst();
    if (!tenant) return;
    this.push.toPermission(tenant.id, 'production.release.decide', {
      title: 'Production release waiting',
      body: `${release.requestedBy ?? 'A release'} is waiting for you to finish or roll it back.`,
      path: '/production-releases',
      collapseId: `release-${release.id}`,
    });
  }
}
