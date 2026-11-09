import type { SyncProgress } from '@pulsegrid/shared';
import { Controller, Get } from '@nestjs/common';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { TenantDatabase } from '../../database/tenant-database';
import { SyncProgressStore } from './sync-progress.store';

@Controller('cloud/sync-progress')
export class SyncProgressController {
  constructor(
    private readonly database: TenantDatabase,
    private readonly progress: SyncProgressStore,
  ) {}

  @Get()
  async list(@CurrentAuth() { tenantId }: AuthContext): Promise<SyncProgress[]> {
    const accounts = await this.database.run(tenantId, (trx) =>
      trx.selectFrom('cloud_accounts').select('id').execute(),
    );
    return this.progress.watched(accounts.map(({ id }) => ({ tenantId, accountId: id })));
  }
}
