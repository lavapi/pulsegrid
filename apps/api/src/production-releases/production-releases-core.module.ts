import { Module } from '@nestjs/common';
import { PRODUCTION_CLIENTS, ProductionReleasesAws, productionClients } from './production-releases.aws';
import {
  loadProductionReleasesSetup,
  PRODUCTION_RELEASES_SETUP,
  type ProductionReleasesSetup,
} from './production-releases.settings';

/** Reading production releases, for the API and the worker. */
@Module({
  providers: [
    { provide: PRODUCTION_RELEASES_SETUP, useFactory: () => loadProductionReleasesSetup(process.env) },
    {
      provide: PRODUCTION_CLIENTS,
      inject: [PRODUCTION_RELEASES_SETUP],
      useFactory: (setup: ProductionReleasesSetup) => productionClients(setup),
    },
    ProductionReleasesAws,
  ],
  exports: [PRODUCTION_RELEASES_SETUP, PRODUCTION_CLIENTS, ProductionReleasesAws],
})
export class ProductionReleasesCoreModule {}
