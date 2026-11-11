import type { UserPermission } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import type { CloudAccountRow } from '../../database/schema';
import { experimentAccess } from './experiment-access';

const account = (sealed = true) => ({ encrypted_credentials: sealed ? 'sealed' : null }) as CloudAccountRow;
const staging = { name: 'Staging', isProduction: false };
const runner = new Set<UserPermission>(['experiment.run']);

describe('experimentAccess', () => {
  it('allows people with the permission outside production', () => {
    expect(experimentAccess({ account: account(), environment: staging }, runner)).toEqual({
      canRun: true,
      blockedReason: null,
    });
  });

  it('needs the production permission in production', () => {
    const production = { name: 'Staging', isProduction: true };
    expect(experimentAccess({ account: account(), environment: production }, runner).blockedReason).toBe(
      'Ask your super admin for the Run production failover tests permission.',
    );
    const productionRunner = new Set<UserPermission>(['production.experiment.run']);
    expect(experimentAccess({ account: account(), environment: production }, productionRunner).canRun).toBe(true);
  });

  it('puts the permission first, then the access key', () => {
    expect(experimentAccess({ account: account(false), environment: staging }, runner).blockedReason).toContain(
      'no access key',
    );
    expect(experimentAccess({ account: account(), environment: staging }, new Set()).blockedReason).toContain(
      'Run staging failover tests',
    );
    expect(experimentAccess({ account: account(), environment: null }, runner).blockedReason).toBe(
      'Assign this account to an environment first.',
    );
  });
});
