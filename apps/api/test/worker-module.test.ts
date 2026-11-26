import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { ProductionReleaseAlertsWorker } from '../src/production-releases/production-release-alerts.worker';
import { WorkerModule } from '../src/worker.module';
import { appUrl } from './support/test-app';

describe('the worker', () => {
  it('builds with every job it runs, so a missing dependency fails here and not on deploy', async () => {
    Object.assign(process.env, {
      PUBLIC_URL: 'http://localhost:3000',
      DATABASE_URL: appUrl,
      REDIS_URL: 'redis://localhost:6379/1',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    expect(moduleRef.get(ProductionReleaseAlertsWorker)).toBeDefined();
    await moduleRef.close();
  });
});
