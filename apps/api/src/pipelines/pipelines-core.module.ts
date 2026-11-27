import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryCoreModule } from '../inventory/inventory-core.module';
import { PushCoreModule } from '../push/push-core.module';
import { GitConnectionsService } from './git/git-connections.service';
import { GIT_PROVIDER_LIST } from './git/git-provider';
import { GitProviderRegistry } from './git/git-provider-registry';
import { githubProvider } from './git/github/github.provider';
import { PipelineRunAlerts } from './pipeline-run-alerts';
import { PipelineRunWatches } from './pipeline-run-watches';

/** Git connections and followed runs, for the API and the worker. */
@Module({
  imports: [AuditModule, InventoryCoreModule, PushCoreModule],
  providers: [
    { provide: GIT_PROVIDER_LIST, useValue: [githubProvider] },
    GitConnectionsService,
    GitProviderRegistry,
    PipelineRunAlerts,
    PipelineRunWatches,
  ],
  exports: [GIT_PROVIDER_LIST, GitConnectionsService, GitProviderRegistry, PipelineRunAlerts, PipelineRunWatches],
})
export class PipelinesCoreModule {}
