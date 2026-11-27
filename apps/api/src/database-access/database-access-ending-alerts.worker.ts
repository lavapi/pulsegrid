import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { RepeatingJob } from '../common/repeating-job';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DatabaseAccessEndingAlerts } from './database-access-ending-alerts';

const CHECK_EVERY_MS = 60_000;

@Injectable()
export class DatabaseAccessEndingAlertsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly job: RepeatingJob;

  constructor(
    alerts: DatabaseAccessEndingAlerts,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.job = new RepeatingJob('database-access-ending-alerts', CHECK_EVERY_MS, () => alerts.check(), new Logger(DatabaseAccessEndingAlertsWorker.name));
  }

  onApplicationBootstrap(): Promise<void> {
    return this.job.start(this.config.redis);
  }

  onApplicationShutdown(): Promise<void> {
    return this.job.stop();
  }
}
