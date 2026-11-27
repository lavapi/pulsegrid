import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { RepeatingJob } from '../common/repeating-job';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { ProductionReleaseAlerts } from './production-release-alerts';

const CHECK_EVERY_MS = 60_000;

/** Checks once a minute whether a production release is waiting, when production releases are set up. */
@Injectable()
export class ProductionReleaseAlertsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly job: RepeatingJob;

  constructor(
    private readonly alerts: ProductionReleaseAlerts,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.job = new RepeatingJob('production-release-alerts', CHECK_EVERY_MS, () => this.alerts.check(), new Logger(ProductionReleaseAlertsWorker.name));
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.alerts.enabled) await this.job.start(this.config.redis);
  }

  onApplicationShutdown(): Promise<void> {
    return this.job.stop();
  }
}
