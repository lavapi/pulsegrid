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

  it('puts production first, then the access key, then the permission', () => {
    const production = { name: 'Staging', isProduction: true };
    expect(experimentAccess({ account: account(false), environment: production }, new Set()).blockedReason).toBe(
      'Production is read-only.',
    );
    expect(experimentAccess({ account: account(false), environment: staging }, new Set()).blockedReason).toContain(
      'no access key',
    );
    expect(experimentAccess({ account: account(), environment: staging }, new Set()).blockedReason).toContain(
      'Run staging fault experiments',
    );
    expect(experimentAccess({ account: account(), environment: null }, runner).blockedReason).toBe(
      'Assign this account to an environment first.',
    );
  });
});
