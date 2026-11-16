import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/schema';
import { SECURITY_ALERTS_SETTINGS, type SecurityAlertsSettings } from './security-alerts.settings';

/** The project that receives the organization's security alerts, named by SECURITY_ALERTS_PROJECT. */
@Injectable()
export class ReceivingProject {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    @Inject(SECURITY_ALERTS_SETTINGS) private readonly settings: SecurityAlertsSettings,
  ) {}

  async id(): Promise<string | null> {
    if (!this.settings.projectSlug) {
      return null;
    }
    const tenant = await this.db
      .selectFrom('tenants')
      .select('id')
      .where('slug', '=', this.settings.projectSlug)
      .executeTakeFirst();
    return tenant?.id ?? null;
  }
}
