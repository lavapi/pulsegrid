import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ProductionReleasesCoreModule } from './production-releases-core.module';
import { ProductionReleasesController } from './production-releases.controller';
import { ProductionReleasesService } from './production-releases.service';

@Module({
  imports: [AuditModule, AuthModule, ProductionReleasesCoreModule],
  controllers: [ProductionReleasesController],
  providers: [ProductionReleasesService],
})
export class ProductionReleasesModule {}
