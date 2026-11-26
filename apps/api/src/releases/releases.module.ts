import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryCoreModule } from '../inventory/inventory-core.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { ReleasesController } from './releases.controller';
import { ReleasesService } from './releases.service';

@Module({
  imports: [AuditModule, InventoryCoreModule, PipelinesModule],
  controllers: [ReleasesController],
  providers: [ReleasesService],
})
export class ReleasesModule {}
