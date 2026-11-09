import { describe, expect, it } from 'vitest';
import { environmentLabel, environmentTone } from './account-environment';

describe('environmentTone', () => {
  it('marks production red', () => {
    expect(environmentTone({ environmentName: 'Prod', isProduction: true })).toBe('danger');
  });

  it('marks staging amber', () => {
    expect(environmentTone({ environmentName: 'Staging', isProduction: false })).toBe('warning');
    expect(environmentTone({ environmentName: 'EU stg', isProduction: false })).toBe('warning');
  });

  it('keeps other environments neutral', () => {
    expect(environmentTone({ environmentName: 'QA', isProduction: false })).toBe('neutral');
    expect(environmentTone({ environmentName: null, isProduction: false })).toBe('neutral');
  });
});

describe('environmentLabel', () => {
  it('shows the environment name', () => {
    expect(environmentLabel({ environmentName: 'Staging', isProduction: false })).toBe('Staging');
  });

  it('says when an account has no environment', () => {
    expect(environmentLabel({ environmentName: null, isProduction: false })).toBe('No environment');
  });
});
