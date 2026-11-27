import type { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { createQueueConnection, queuePrefix, type RedisSettings } from '../redis/redis-connection';

const KEEP = { removeOnComplete: 10, removeOnFail: 10 };

/** A job that runs on its own every so often in the worker, one at a time. */
export class RepeatingJob {
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly name: string,
    private readonly everyMs: number,
    private readonly run: () => Promise<void>,
    private readonly logger: Logger,
  ) {}

  async start(redis: RedisSettings): Promise<void> {
    const options = { connection: createQueueConnection(redis), prefix: queuePrefix(redis) };
    this.queue = new Queue(this.name, options);
    await this.queue.upsertJobScheduler(this.name, { every: this.everyMs }, { name: this.name, opts: KEEP });
    this.worker = new Worker(this.name, () => this.run(), {
      connection: createQueueConnection(redis),
      prefix: queuePrefix(redis),
      concurrency: 1,
    });
    this.worker.on('failed', (_job, error) => this.logger.warn(`${this.name} failed: ${error.name}`));
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
