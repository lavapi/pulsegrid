import { describe, expect, it } from 'vitest';
import { experimentPath, experimentRunPath, formatDuration, waveChoice, formatStepDuration, historyRunPath, reportWindow, stateLabel, stateTone } from './experiments';

describe('experiment helpers', () => {
  it('colours states by what they mean', () => {
    expect(stateTone('running')).toBe('warning');
    expect(stateTone('completed')).toBe('success');
    expect(stateTone('failed')).toBe('danger');
    expect(stateTone('stopped')).toBe('neutral');
    expect(stateTone('something new')).toBe('neutral');
  });

  it('reads AWS durations', () => {
    expect(formatStepDuration('PT5M')).toBe('5 min');
    expect(formatStepDuration('PT1H30M')).toBe('1 h 30 min');
    expect(formatStepDuration('PT45S')).toBe('45 s');
    expect(formatStepDuration('5 minutes')).toBe('5 minutes');
    expect(formatStepDuration(null)).toBeNull();
  });

  it('labels states and builds paths', () => {
    expect(stateLabel('running')).toBe('Running');
    expect(experimentPath('eu-central-1', 'EXP1')).toBe('/failover-tests/eu-central-1/EXP1');
    expect(experimentRunPath('3f8a')).toBe('/failover-tests/runs/3f8a');
  });
});

describe('reports', () => {
  it('links a history run to its own account', () => {
    expect(historyRunPath('r1', 'a b')).toBe('/failover-tests/runs/r1?account=a%20b');
  });

  it('formats durations', () => {
    expect(formatDuration('2026-11-11T10:00:00Z', '2026-11-11T10:00:20Z')).toBe('under 1 min');
    expect(formatDuration('2026-11-11T10:00:00Z', '2026-11-11T11:25:00Z')).toBe('1 h 25 min');
    expect(formatDuration('2026-11-11T10:00:00Z', null)).toBeNull();
  });

  it('pads the load window by 10 minutes without going past now', () => {
    const now = new Date('2026-11-11T10:25:00Z');
    expect(reportWindow('2026-11-11T10:00:00Z', '2026-11-11T10:20:00Z', now)).toEqual({
      from: '2026-11-11T09:50:00.000Z',
      to: '2026-11-11T10:25:00.000Z',
    });
    expect(reportWindow(null, null, now)).toBeNull();
  });
});

describe('waveChoice', () => {
  const capacity = [
    { region: 'eu-central-1', quota: 5, quotaKnown: true, running: 1 },
    { region: 'eu-west-1', quota: 10, quotaKnown: true, running: 0 },
  ];

  it('suggests the free slots in the run regions', () => {
    expect(waveChoice(capacity, ['eu-central-1'], 11, null)).toEqual({ suggested: 4, max: 5, free: 4 });
  });

  it('prefers the group last choice, within the limits', () => {
    expect(waveChoice(capacity, ['eu-central-1'], 11, 2).suggested).toBe(2);
    expect(waveChoice(capacity, ['eu-central-1'], 3, 9)).toMatchObject({ suggested: 3, max: 3 });
  });

  it('never suggests less than one, even when the account is full', () => {
    const full = [{ region: 'eu-central-1', quota: 5, quotaKnown: false, running: 5 }];
    expect(waveChoice(full, ['eu-central-1'], 4, null)).toEqual({ suggested: 1, max: 4, free: 0 });
  });
});
