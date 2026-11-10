import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CloudActivityController } from './activity/cloud-activity.controller';
import { CloudActivityService } from './activity/cloud-activity.service';
import { ExperimentsController } from './experiments/experiments.controller';
import { ExperimentsService } from './experiments/experiments.service';
import { ResourceActionsController } from './actions/resource-actions.controller';
import { ResourceActionsService } from './actions/resource-actions.service';
import { ResourceActivityController } from './actions/resource-activity.controller';
import { CloudAccountsController } from './accounts/cloud-accounts.controller';
import { CloudAccountsService } from './accounts/cloud-accounts.service';
import { CostsController } from './costs/costs.controller';
import { CostsService } from './costs/costs.service';
import { EnvironmentDomainsController } from './environments/environment-domains.controller';
import { EnvironmentDomainsService } from './environments/environment-domains.service';
import { EnvironmentsController } from './environments/environments.controller';
import { EnvironmentsService } from './environments/environments.service';
import { InventoryCoreModule } from './inventory-core.module';
import { ResourceLoadController } from './load/resource-load.controller';
import { ResourceLoadService } from './load/resource-load.service';
import { ResourceLogsController } from './logs/resource-logs.controller';
import { ResourceLogsService } from './logs/resource-logs.service';
import { ResourceAccess } from './resources/resource-access';
import { ResourcesController } from './resources/resources.controller';
import { ResourcesService } from './resources/resources.service';
import { SecretsController } from './secrets/secrets.controller';
import { SecretsService } from './secrets/secrets.service';
import { SyncProgressController } from './sync/sync-progress.controller';

@Module({
  imports: [AuditModule, InventoryCoreModule],
  controllers: [
    CloudAccountsController,
    CloudActivityController,
    ExperimentsController,
    CostsController,
    EnvironmentDomainsController,
    EnvironmentsController,
    ResourceActionsController,
    ResourceActivityController,
    ResourceLoadController,
    ResourceLogsController,
    ResourcesController,
    SecretsController,
    SyncProgressController,
  ],
  providers: [
    CloudAccountsService,
    CloudActivityService,
    ExperimentsService,
    CostsService,
    EnvironmentDomainsService,
    EnvironmentsService,
    ResourceAccess,
    ResourceActionsService,
    ResourceLoadService,
    ResourceLogsService,
    ResourcesService,
    SecretsService,
  ],
})
export class InventoryModule {}
