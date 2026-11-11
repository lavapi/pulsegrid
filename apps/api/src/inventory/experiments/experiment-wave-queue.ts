import type { Queue } from 'bullmq';

export const WAVE_QUEUE_NAME = 'experiment-waves';
export const ADVANCE_WAVES_JOB = 'advance-waves';

export class ExperimentWaveQueue {
  constructor(private readonly queue: Queue) {}

  async scheduleAdvance(everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(
      ADVANCE_WAVES_JOB,
      { every: everyMs },
      { name: ADVANCE_WAVES_JOB, opts: { removeOnComplete: true, removeOnFail: true } },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
