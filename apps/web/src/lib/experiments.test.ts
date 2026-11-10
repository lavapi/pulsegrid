import { describe, expect, it } from 'vitest';
import { experimentPath, experimentRunPath, formatStepDuration, stateLabel, stateTone } from './experiments';

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
    expect(experimentPath('eu-central-1', 'EXP1')).toBe('/experiments/eu-central-1/EXP1');
    expect(experimentRunPath('3f8a')).toBe('/experiments/runs/3f8a');
  });
});
