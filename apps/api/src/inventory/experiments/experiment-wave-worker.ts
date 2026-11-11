import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { createQueueConnection, queuePrefix } from '../../redis/redis-connection';
import { ExperimentWaveQueue, WAVE_QUEUE_NAME } from './experiment-wave-queue';
import { ExperimentWaves } from './experiment-waves';

const CHECK_INTERVAL_MS = 15_000;

/** Starts the next waiting tests of group runs and Run all as earlier ones end. */
@Injectable()
export class ExperimentWaveWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ExperimentWaveWorker.name);
  private worker?: Worker;

  constructor(
    private readonly waves: ExperimentWaves,
    private readonly queue: ExperimentWaveQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.scheduleAdvance(CHECK_INTERVAL_MS);
    this.worker = new Worker(WAVE_QUEUE_NAME, () => this.waves.advanceAll(), {
      connection: createQueueConnection(this.config.redis),
      prefix: queuePrefix(this.config.redis),
    });
    this.worker.on('failed', (_job, error) => {
      this.logger.error(`Advancing test runs failed: ${error.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
