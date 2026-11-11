import { describe, expect, it } from 'vitest';
import { deploymentStatusLabel, stepStates } from './service-deployments';

describe('stepStates', () => {
  it('marks earlier stages done and the current one in progress', () => {
    expect(stepStates({ stage: 'production-traffic', status: 'in-progress' })).toEqual({
      'scale-up': 'done',
      'test-traffic': 'done',
      'production-traffic': 'current',
      'bake-time': 'upcoming',
      'clean-up': 'upcoming',
    });
  });

  it('marks every stage done once completed, and the stage that failed on a rollback', () => {
    expect(Object.values(stepStates({ stage: 'clean-up', status: 'succeeded' }))).toEqual(Array(5).fill('done'));
    expect(stepStates({ stage: 'bake-time', status: 'rolled-back' })['bake-time']).toBe('failed');
  });

  it('labels statuses in plain words', () => {
    expect(deploymentStatusLabel('rolled-back')).toBe('Rolled back');
  });
});
