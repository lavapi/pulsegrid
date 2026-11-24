import { AWS_PROVIDER, type ConnectionMethod } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { replacementMethods, replacementText } from './connection-methods';

const ROLE: ConnectionMethod = { id: 'role', label: 'Role', description: 'Take on a role.', fields: [] };
const KEY: ConnectionMethod = { id: 'key', label: 'Access key', description: 'Use a key.', fields: [] };

describe('replacementMethods', () => {
  it('offers an account on a key a role first, and a new key', () => {
    expect(replacementMethods('key', [ROLE, KEY]).map(({ id }) => id)).toEqual(['role', 'key']);
  });

  it('offers an account on a role only another role, never a key', () => {
    expect(replacementMethods('role', [ROLE, KEY]).map(({ id }) => id)).toEqual(['role']);
  });

  it('connects AWS only through a role', () => {
    expect(AWS_PROVIDER.connectionMethods.map(({ id }) => id)).toEqual(['role']);
  });
});

describe('replacementText', () => {
  it('says a key account switches to a role, and that PulseGrid drops the stored key', () => {
    const text = replacementText('key', ROLE, 'Production');
    expect(text.label).toBe('Switch to a role');
    expect(text.description).toContain('PulseGrid deletes the stored key once the role works');
    expect(text.success).toBe('Production now uses a role');
  });

  it('says a role or key of the same kind is replaced', () => {
    expect(replacementText('key', KEY, 'Staging').label).toBe('Replace access key');
    expect(replacementText('role', ROLE, 'Staging').label).toBe('Replace role');
  });
});
