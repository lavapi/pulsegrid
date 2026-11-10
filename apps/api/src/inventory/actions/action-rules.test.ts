import { CLOUD_PERMISSIONS, productionPermission, type UserPermission } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { actionOption } from './action-rules';

const staging = { name: 'Staging', isProduction: false };
const production = { name: 'Production', isProduction: true };
const granted = (...permissions: UserPermission[]) => new Set(permissions);

describe('actionOption', () => {
  it.each(CLOUD_PERMISSIONS)('allows %s in staging with the staging permission', (permission) => {
    expect(actionOption(permission, staging, granted(permission))).toEqual({ permission, blockedReason: null });
  });

  it.each(CLOUD_PERMISSIONS)('allows %s in production only with the production permission', (permission) => {
    expect(actionOption(permission, production, granted(permission)).blockedReason).toMatch(
      /^Ask your super admin for the .* production .* permission\.$/,
    );
    expect(actionOption(permission, production, granted(productionPermission(permission))).blockedReason).toBeNull();
  });

  it('does not let the production permission act on staging', () => {
    expect(actionOption('server.reboot', staging, granted('production.server.reboot')).blockedReason).toBe(
      'Ask your super admin for the Reboot a staging server permission.',
    );
  });

  it('follows the production flag rather than the name', () => {
    const flagged = { name: 'Staging', isProduction: true };
    expect(actionOption('server.reboot', flagged, granted('server.reboot')).blockedReason).toBe(
      'Ask your super admin for the Reboot a production server permission.',
    );
  });

  it('asks for an environment when there is none', () => {
    expect(actionOption('database.reboot', null, granted('database.reboot')).blockedReason).toBe(
      'Assign this account to an environment first.',
    );
  });
});
