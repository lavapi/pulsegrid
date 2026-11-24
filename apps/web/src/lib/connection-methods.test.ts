import { AWS_PROVIDER } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { replacementMethods, replacementText } from './connection-methods';

describe('replacementMethods', () => {
  it('offers an account on a key a role first, and a new key', () => {
    expect(replacementMethods('key', AWS_PROVIDER.connectionMethods).map(({ id }) => id)).toEqual(['role', 'key']);
  });

  it('offers an account on a role only another role, never a key', () => {
    expect(replacementMethods('role', AWS_PROVIDER.connectionMethods).map(({ id }) => id)).toEqual(['role']);
  });

  it('recommends a role when adding an account', () => {
    expect(AWS_PROVIDER.connectionMethods[0]?.id).toBe('role');
  });
});

describe('replacementText', () => {
  const [role, key] = AWS_PROVIDER.connectionMethods;

  it('says a key account switches to a role, and that PulseGrid drops the stored key', () => {
    const text = replacementText('key', role!, 'Production');
    expect(text.label).toBe('Switch to a role');
    expect(text.description).toContain('PulseGrid deletes the stored key once the role works');
    expect(text.success).toBe('Production now uses a role');
  });

  it('says a role or key of the same kind is replaced', () => {
    expect(replacementText('key', key!, 'Staging').label).toBe('Replace access key');
    expect(replacementText('role', role!, 'Staging').label).toBe('Replace role');
  });
});

