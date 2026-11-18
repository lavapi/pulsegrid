import { describe, expect, it } from 'vitest';
import { refusalMessage } from './production-releases-errors';
import { loadProductionReleasesSetup } from './production-releases.settings';
import { activeReleaseId, newestFirst, toRelease } from './release-records';

const HOLD_ITEM = {
  id: { S: 'rel-20261118-0930' },
  status: { S: 'HOLD' },
  tags: { S: JSON.stringify({ 'frontend-next': 'main-9f8e7d6', backend: 'main-1a2b3c4' }) },
  services: { S: JSON.stringify({ backend: { cluster: 'production' } }) },
  requested_by: { S: 'ada@example.test' },
  created_at: { N: '1794994200' },
  hold_started_at: { S: '1794994800' },
  hold_until: { S: '1795023600' },
  snapshot: { S: 'pre-release-rel-20261118-0930' },
};

describe('release records', () => {
  it('reads a release, with times stored as strings or numbers', () => {
    expect(toRelease(HOLD_ITEM)).toEqual({
      id: 'rel-20261118-0930',
      status: 'HOLD',
      components: [
        { name: 'backend', tag: 'main-1a2b3c4' },
        { name: 'frontend-next', tag: 'main-9f8e7d6' },
      ],
      requestedBy: 'ada@example.test',
      createdAt: '2026-11-18T09:30:00.000Z',
      holdStartedAt: '2026-11-18T09:40:00.000Z',
      holdUntil: '2026-11-18T17:40:00.000Z',
      decision: null,
      decidedBy: null,
      snapshot: 'pre-release-rel-20261118-0930',
    });
  });

  it('reads a decision, and survives broken JSON and missing fields', () => {
    const release = toRelease({ id: { S: 'r' }, tags: { S: '{not json' }, decision: { S: 'rollback' }, decided_by: { S: 'bo' } });
    expect(release).toMatchObject({ components: [], decision: 'ROLLBACK', decidedBy: 'bo', createdAt: null, status: 'UNKNOWN' });
  });

  it('names the release in progress', () => {
    expect(activeReleaseId({ id: { S: 'ACTIVE' }, release_id: { S: 'rel-1' } })).toBe('rel-1');
    expect(activeReleaseId(undefined)).toBeNull();
  });

  it('keeps the newest releases first', () => {
    const at = (id: string, createdAt: string | null) => ({ ...toRelease({ id: { S: id } }), createdAt });
    expect(newestFirst([at('a', '2026-01-01'), at('b', null), at('c', '2026-03-01')], 2).map(({ id }) => id)).toEqual([
      'c',
      'a',
    ]);
  });
});

describe('refusalMessage', () => {
  it.each([
    ['No release in progress', 'There is no production release in progress.'],
    ['Release rel-1 is not in HOLD (status SWITCH)', 'This release is no longer waiting for a decision.'],
    ['Release rel-1 was already decided: FINISH', 'Someone already decided on this release.'],
    [undefined, "PulseGrid couldn't record the decision. Try again, or use the Release production workflow in GitHub."],
  ])('turns %s into a plain sentence', (refusal, message) => {
    expect(refusalMessage(refusal)).toBe(message);
  });
});

describe('production release settings', () => {
  it('stays off until the role and project are set, and defaults the rest', () => {
    expect(loadProductionReleasesSetup({})).toBeNull();
    expect(
      loadProductionReleasesSetup({
        PRODUCTION_RELEASES_ROLE_ARN: 'arn:aws:iam::860922939595:role/PulseGridProductionReleases',
        PRODUCTION_RELEASES_PROJECT: 'acme',
      }),
    ).toEqual({
      roleArn: 'arn:aws:iam::860922939595:role/PulseGridProductionReleases',
      projectSlug: 'acme',
      region: 'eu-central-1',
      table: 'dreamzino-production-releases',
      decideFunction: 'dreamzino-production-release-decide',
    });
    expect(() => loadProductionReleasesSetup({ PRODUCTION_RELEASES_ROLE_ARN: 'nope' })).toThrow('PRODUCTION_RELEASES_ROLE_ARN');
  });
});
