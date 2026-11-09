import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryCoreModule } from '../inventory/inventory-core.module';
import { GitConnectionsController } from './git/git-connections.controller';
import { GitConnectionsService } from './git/git-connections.service';
import { GIT_PROVIDER_LIST } from './git/git-provider';
import { GitProviderRegistry } from './git/git-provider-registry';
import { githubProvider } from './git/github/github.provider';
import { PipelineAppsController } from './pipeline-apps.controller';
import { PipelineAppsService } from './pipeline-apps.service';
import { PipelineCache } from './pipeline-cache';
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';

@Module({
  imports: [AuditModule, InventoryCoreModule],
  controllers: [GitConnectionsController, PipelineAppsController, PipelinesController],
  providers: [
    { provide: GIT_PROVIDER_LIST, useValue: [githubProvider] },
    GitConnectionsService,
    GitProviderRegistry,
    PipelineAppsService,
    PipelineCache,
    PipelinesService,
  ],
  exports: [PipelineCache, PipelinesService],
})
export class PipelinesModule {}
