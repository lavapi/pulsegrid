import { CLOUD_PERMISSIONS } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { actionOption } from './action-rules';

const staging = { name: 'Staging', isProduction: false };

describe('actionOption', () => {
  it.each(CLOUD_PERMISSIONS)('allows %s outside production', (permission) => {
    expect(actionOption(permission, staging)).toEqual({ permission, blockedReason: null });
  });

  it.each(CLOUD_PERMISSIONS)('blocks %s in production', (permission) => {
    expect(actionOption(permission, { name: 'Production', isProduction: true }).blockedReason).toBe(
      'Production is read-only.',
    );
  });

  it('follows the production flag rather than the name', () => {
    expect(actionOption('server.reboot', { name: 'Staging', isProduction: true }).blockedReason).toBe(
      'Production is read-only.',
    );
  });

  it('asks for an environment when there is none', () => {
    expect(actionOption('database.reboot', null).blockedReason).toBe(
      'Assign this account to an environment first.',
    );
  });
});
