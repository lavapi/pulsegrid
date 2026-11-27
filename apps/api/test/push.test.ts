import { safeNext } from '@pulsegrid/shared';
import { describe, expect, it, vi } from 'vitest';
import { ProductionReleaseAlerts } from '../src/production-releases/production-release-alerts';

describe('returning after sign-in', () => {
  it('allows only a path on this site', () => {
    expect(safeNext('/mobile/sign-in?challenge=abc&device=Ada%27s%20iPhone')).toBe('/mobile/sign-in?challenge=abc&device=Ada%27s%20iPhone');
    for (const unsafe of ['//evil.example', '/\\evil.example', 'https://evil.example', 'mobile', '/a b', 42, undefined]) {
      expect(safeNext(unsafe)).toBeNull();
    }
  });
});

describe('waiting production release alerts', () => {
  const waiting = { id: 'rel-1', status: 'HOLD', decision: null, requestedBy: 'ada@example.test' };
  const alertsWith = (release: object | null, setOnce = true) => {
    const push = { toPermission: vi.fn() };
    const redis = { set: vi.fn(async () => (setOnce ? 'OK' : null)) };
    const db = { selectFrom: () => ({ select: () => ({ where: () => ({ executeTakeFirst: async () => ({ id: 'tenant-1' }) }) }) }) };
    const alerts = new ProductionReleaseAlerts(
      { current: async () => release } as never,
      { projectSlug: 'acme' } as never,
      db as never,
      redis as never,
      push as never,
    );
    return { alerts, push, redis };
  };

  it('tells the people who decide, once per release', async () => {
    const { alerts, push, redis } = alertsWith(waiting);
    await alerts.check();
    expect(redis.set).toHaveBeenCalledWith('production-release:announced:rel-1', '1', 'EX', expect.any(Number), 'NX');
    expect(push.toPermission).toHaveBeenCalledWith('tenant-1', 'production.release.decide', 'production_releases', {
      title: 'Production release waiting',
      body: 'ada@example.test is waiting for you to finish or roll it back.',
      path: '/production-releases',
      collapseId: 'release-rel-1',
    });
  });

  it('stays quiet for a release already announced, decided, or not waiting', async () => {
    for (const { alerts, push } of [
      alertsWith(waiting, false),
      alertsWith({ ...waiting, decision: 'FINISH' }),
      alertsWith({ ...waiting, status: 'SUCCEEDED' }),
      alertsWith(null),
    ]) {
      await alerts.check();
      expect(push.toPermission).not.toHaveBeenCalled();
    }
  });
});
