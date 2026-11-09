import type { UserPermission } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { secretAccess } from './secret-rules';

const input = (permissions: UserPermission[], overrides = {}) => ({
  granted: new Set(permissions),
  environmentName: 'Staging',
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

  it.each(['Production', 'Live', 'Customer accounts'])('hides values in %s', (environmentName) => {
    expect(secretAccess(input(['secret.write'], { environmentName }))).toEqual({
      canRead: false,
      canWrite: false,
      reason: 'Production is read-only.',
    });
  });

  it('asks for an environment when there is none', () => {
    expect(secretAccess(input(['secret.write'], { environmentName: null })).canRead).toBe(false);
  });

  it('lets people read but not change a secret AWS manages', () => {
    const access = secretAccess(input(['secret.write'], { managedBy: 'rds' }));
    expect(access).toMatchObject({ canRead: true, canWrite: false });
    expect(access.reason).toContain('AWS manages');
  });
});
