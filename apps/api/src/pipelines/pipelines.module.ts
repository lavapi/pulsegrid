import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryCoreModule } from '../inventory/inventory-core.module';
import { GitConnectionsController } from './git/git-connections.controller';
import { PipelineAppsController } from './pipeline-apps.controller';
import { PipelineAppsService } from './pipeline-apps.service';
import { PipelineCache } from './pipeline-cache';
import { PipelinesController } from './pipelines.controller';
import { PipelinesCoreModule } from './pipelines-core.module';
import { PipelinesService } from './pipelines.service';

@Module({
  imports: [AuditModule, InventoryCoreModule, PipelinesCoreModule],
  controllers: [GitConnectionsController, PipelineAppsController, PipelinesController],
  providers: [PipelineAppsService, PipelineCache, PipelinesService],
  exports: [PipelineCache, PipelinesService],
})
export class PipelinesModule {}
