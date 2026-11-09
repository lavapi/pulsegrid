import { CLOUD_PERMISSIONS } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { actionOption } from './action-rules';

describe('actionOption', () => {
  it.each(CLOUD_PERMISSIONS)('allows %s in staging', (permission) => {
    expect(actionOption(permission, 'Staging')).toEqual({ permission, blockedReason: null });
  });

  it.each(CLOUD_PERMISSIONS)('blocks %s in production', (permission) => {
    expect(actionOption(permission, 'Production').blockedReason).toBe('Production is read-only.');
  });

  it.each(['Live', 'Prod', 'Customer accounts', 'Staging prod copy'])('fails closed for %s', (name) => {
    expect(actionOption('server.reboot', name).blockedReason).toBe('Production is read-only.');
  });

  it('asks for an environment when there is none', () => {
    expect(actionOption('database.reboot', null).blockedReason).toBe(
      'Assign this account to an environment first.',
    );
  });
});
