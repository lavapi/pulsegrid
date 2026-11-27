import { describe, expect, it } from 'vitest';
import { costRise } from './cost-rise';

/** November has 30 days, so on the 10th a month heads for three times what it has cost so far. */
const tenth = new Date('2026-11-10T12:00:00Z');

describe('costRise', () => {
  it('finds a sharp rise, by how much and which service rose most', () => {
    const rise = costRise(
      [
        { service: 'Amazon RDS', thisMonth: 300, lastMonth: 500 },
        { service: 'Amazon ECS', thisMonth: 100, lastMonth: 400 },
      ],
      tenth,
    );
    expect(rise).toEqual({ projected: 1200, lastMonth: 900, share: expect.closeTo(0.3333, 3), biggest: { service: 'Amazon RDS', amount: 400 } });
  });

  it('stays quiet for a small rise, a few dollars, the first days, or an account with no last month', () => {
    expect(costRise([{ service: 'S3', thisMonth: 110, lastMonth: 300 }], tenth)).toBeNull();
    expect(costRise([{ service: 'S3', thisMonth: 20, lastMonth: 30 }], tenth)).toBeNull();
    expect(costRise([{ service: 'S3', thisMonth: 300, lastMonth: 300 }], new Date('2026-11-04T12:00:00Z'))).toBeNull();
    expect(costRise([{ service: 'S3', thisMonth: 300, lastMonth: 0 }], tenth)).toBeNull();
  });
});
