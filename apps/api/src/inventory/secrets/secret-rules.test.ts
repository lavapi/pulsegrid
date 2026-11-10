import type { UserPermission } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { secretAccess } from './secret-rules';

const input = (permissions: UserPermission[], overrides = {}) => ({
  granted: new Set(permissions),
  environment: { name: 'Staging', isProduction: false },
  managedBy: undefined,
  ...overrides,
});

describe('secretAccess', () => {
  it('lets a reader read but not write', () => {
    expect(secretAccess(input(['secret.read']))).toEqual({ canRead: true, canWrite: false, reason: null });
  });

  it('lets a writer read and write', () => {
    expect(secretAccess(input(['secret.write']))).toEqual({ canRead: true, canWrite: true, reason: null });
  });

  it('needs a permission', () => {
    expect(secretAccess(input(['server.reboot'])).canRead).toBe(false);
  });

  it('hides values in production', () => {
    const environment = { name: 'Staging', isProduction: true };
    expect(secretAccess(input(['secret.write'], { environment }))).toEqual({
      canRead: false,
      canWrite: false,
      reason: 'Production is read-only.',
    });
  });

  it('asks for an environment when there is none', () => {
    expect(secretAccess(input(['secret.write'], { environment: null })).canRead).toBe(false);
  });

  it('lets people read but not change a secret AWS manages', () => {
    const access = secretAccess(input(['secret.write'], { managedBy: 'rds' }));
    expect(access).toMatchObject({ canRead: true, canWrite: false });
    expect(access.reason).toContain('AWS manages');
  });
});
