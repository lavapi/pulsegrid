import { describe, expect, it } from 'vitest';
import { buildCategorySummaries } from './resources.service';

describe('buildCategorySummaries', () => {
  it('splits network resources into separate services', () => {
    const summaries = buildCategorySummaries(
      [
        { type: 'load-balancer', health: 'healthy', count: '2', launch_type: null },
        { type: 'vpc', health: 'healthy', count: '6', launch_type: null },
        { type: 'subnet', health: 'unknown', count: '30', launch_type: null },
      ],
    );
    expect(summaries.map(({ category }) => category)).toEqual(['load-balancing', 'vpc']);
    expect(summaries[1]).toMatchObject({
      health: { healthy: 6, unknown: 30, total: 36 },
    });
  });

  it('lists launch types across services and capacity providers', () => {
    const [ecs] = buildCategorySummaries(
      [
        { type: 'ecs-service', health: 'healthy', count: '12', launch_type: 'FARGATE' },
        { type: 'ecs-service', health: 'degraded', count: '1', launch_type: 'FARGATE' },
        { type: 'ecs-service', health: 'healthy', count: '2', launch_type: 'FARGATE, FARGATE_SPOT' },
      ],
    );
    expect(ecs).toMatchObject({
      launchTypes: ['FARGATE', 'FARGATE_SPOT'],
      types: [{ type: 'ecs-service', count: 15 }],
      health: { degraded: 1, total: 15 },
    });
  });
});
