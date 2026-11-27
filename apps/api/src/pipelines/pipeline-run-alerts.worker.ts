import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { RepeatingJob } from '../common/repeating-job';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PipelineRunAlerts } from './pipeline-run-alerts';

const CHECK_EVERY_MS = 60_000;

@Injectable()
export class PipelineRunAlertsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly job: RepeatingJob;

  constructor(
    alerts: PipelineRunAlerts,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.job = new RepeatingJob('pipeline-run-alerts', CHECK_EVERY_MS, () => alerts.check(), new Logger(PipelineRunAlertsWorker.name));
  }

  onApplicationBootstrap(): Promise<void> {
    return this.job.start(this.config.redis);
  }

  onApplicationShutdown(): Promise<void> {
    return this.job.stop();
  }
}
