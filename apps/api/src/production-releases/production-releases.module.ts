import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PRODUCTION_CLIENTS, ProductionReleasesAws, productionClients } from './production-releases.aws';
import { ProductionReleasesController } from './production-releases.controller';
import { ProductionReleasesService } from './production-releases.service';
import {
  loadProductionReleasesSetup,
  PRODUCTION_RELEASES_SETUP,
  type ProductionReleasesSetup,
} from './production-releases.settings';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [ProductionReleasesController],
  providers: [
    { provide: PRODUCTION_RELEASES_SETUP, useFactory: () => loadProductionReleasesSetup(process.env) },
    {
      provide: PRODUCTION_CLIENTS,
      inject: [PRODUCTION_RELEASES_SETUP],
      useFactory: (setup: ProductionReleasesSetup) => productionClients(setup),
    },
    ProductionReleasesAws,
    ProductionReleasesService,
  ],
})
export class ProductionReleasesModule {}
