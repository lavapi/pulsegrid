import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { RepeatingJob } from '../../common/repeating-job';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { ServiceHealthAlerts } from './service-health-alerts';

/** As often as the inventory syncs, so a service turning degraded is announced within a few minutes. */
const CHECK_EVERY_MS = 2 * 60_000;

@Injectable()
export class ServiceHealthAlertsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly job: RepeatingJob;

  constructor(
    alerts: ServiceHealthAlerts,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.job = new RepeatingJob('service-health-alerts', CHECK_EVERY_MS, () => alerts.check(), new Logger(ServiceHealthAlertsWorker.name));
  }

  onApplicationBootstrap(): Promise<void> {
    return this.job.start(this.config.redis);
  }

  onApplicationShutdown(): Promise<void> {
    return this.job.stop();
  }
}
