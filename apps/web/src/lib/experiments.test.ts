import { describe, expect, it } from 'vitest';
import { experimentPath, experimentRunPath, formatDuration, pdfFileName, formatStepDuration, historyRunPath, reportWindow, stateLabel, stateTone } from './experiments';

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

describe('pdfFileName', () => {
  it('names the file after the run and its day', () => {
    expect(pdfFileName('All tests', '2026-11-11T21:50:00.000Z')).toBe('failover-tests-all-tests-2026-11-11.pdf');
    expect(pdfFileName('Zone outage (eu-central-1a)!', null)).toBe('failover-tests-zone-outage-eu-central-1a-.pdf');
  });
});
