import { describe, expect, it } from 'vitest';
import { dayKeyPrefix, daysOf, fileEnd, fileLoadBalancerId, newestFirstGroups, overlaps, startAfter } from './alb-log-files';

const ARN = 'arn:aws:elasticloadbalancing:eu-central-1:111111111111:loadbalancer/app/game-alb/50dc6c495c0c9188';
const location = { bucket: 'logs', prefix: 'game-staging/', accountId: '111111111111', region: 'eu-central-1', loadBalancerArn: ARN };
const at = (iso: string) => Date.parse(iso);

describe('ALB log file names', () => {
  it("builds AWS's standard path for access and connection logs", () => {
    const day = at('2026-11-11T10:00:00Z');
    expect(dayKeyPrefix(location, 'access', day)).toBe(
      'game-staging/AWSLogs/111111111111/elasticloadbalancing/eu-central-1/2026/11/11/111111111111_elasticloadbalancing_eu-central-1_app.game-alb.50dc6c495c0c9188_',
    );
    expect(dayKeyPrefix({ ...location, prefix: '' }, 'connection', day)).toBe(
      'AWSLogs/111111111111/elasticloadbalancing/eu-central-1/2026/11/11/conn_log_111111111111_elasticloadbalancing_eu-central-1_app.game-alb.50dc6c495c0c9188_',
    );
    expect(startAfter('p/', at('2026-11-11T09:55:00Z'))).toBe('p/20261111T0955Z');
  });

  it('only supports Application Load Balancers', () => {
    expect(fileLoadBalancerId(ARN)).toBe('app.game-alb.50dc6c495c0c9188');
    expect(fileLoadBalancerId(ARN.replace('/app/', '/net/'))).toBeNull();
  });

  it("reads when a file's interval ends from its name", () => {
    expect(fileEnd('x/111_elasticloadbalancing_eu-central-1_app.a.b_20261111T1005Z_10.0.0.1_abc.log.gz')).toBe(
      at('2026-11-11T10:05:00Z'),
    );
    expect(fileEnd('x/readme.txt')).toBeNull();
  });

  it('keeps only files whose 5 minutes overlap the range', () => {
    const from = at('2026-11-11T10:00:00Z');
    const to = at('2026-11-11T10:15:00Z');
    expect(overlaps(at('2026-11-11T10:00:00Z'), from, to)).toBe(false);
    expect(overlaps(at('2026-11-11T10:05:00Z'), from, to)).toBe(true);
    expect(overlaps(at('2026-11-11T10:20:00Z'), from, to)).toBe(true);
    expect(overlaps(at('2026-11-11T10:25:00Z'), from, to)).toBe(false);
  });

  it("looks in the next day's folder for files delivered after midnight", () => {
    expect(daysOf(at('2026-11-11T23:40:00Z'), at('2026-11-11T23:55:00Z'))).toEqual([
      at('2026-11-11T00:00:00Z'),
      at('2026-11-12T00:00:00Z'),
    ]);
    expect(daysOf(at('2026-11-11T09:00:00Z'), at('2026-11-11T10:00:00Z'))).toHaveLength(1);
  });

  it('groups files of the same interval, newest first', () => {
    const groups = newestFirstGroups([
      { key: 'a', endsAt: 1 },
      { key: 'b', endsAt: 2 },
      { key: 'c', endsAt: 1 },
    ]);
    expect(groups.map((group) => group.map(({ key }) => key))).toEqual([['b'], ['a', 'c']]);
  });
});
