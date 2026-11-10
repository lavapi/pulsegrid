import type { CloudAccount } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import {
  followsAccountSwitcher,
  pathAfterSwitch,
  pickAccount,
  pipelineScope,
  selectableAccounts,
  selectedFirst,
} from './account-selection';

const account = (id: string, status: CloudAccount['status'] = 'connected') =>
  ({ id, status }) as CloudAccount;

describe('selectedFirst', () => {
  const accounts = [account('staging'), account('production'), account('audit')];
  const ids = (selectedId: string | null) => selectedFirst(accounts, selectedId).map(({ id }) => id);

  it('puts the selected account first and keeps the others in order', () => {
    expect(ids('audit')).toEqual(['audit', 'staging', 'production']);
  });

  it('keeps the order when nothing matches', () => {
    expect(ids(null)).toEqual(['staging', 'production', 'audit']);
  });
});

describe('pickAccount', () => {
  const accounts = [account('audit'), account('production')];

  it('uses the first account by default', () => {
    expect(pickAccount(accounts, undefined)?.id).toBe('audit');
  });

  it('uses the remembered account', () => {
    expect(pickAccount(accounts, 'production')?.id).toBe('production');
  });

  it('goes back to the first account when access to the remembered one is gone', () => {
    expect(pickAccount(accounts, 'removed')?.id).toBe('audit');
  });

  it('returns nothing when there are no accounts', () => {
    expect(pickAccount([], 'production')).toBeNull();
  });
});

describe('selectableAccounts', () => {
  it('leaves out accounts that are not connected', () => {
    const accounts = [account('a'), account('b', 'pending'), account('c', 'error')];
    expect(selectableAccounts(accounts).map(({ id }) => id)).toEqual(['a']);
  });
});

describe('followsAccountSwitcher', () => {
  it.each(['/', '/infrastructure', '/infrastructure/ecs', '/pipelines'])('includes %s', (path) => {
    expect(followsAccountSwitcher(path)).toBe(true);
  });

  it.each(['/environments', '/environments/compare', '/settings/access'])('excludes %s', (path) => {
    expect(followsAccountSwitcher(path)).toBe(false);
  });
});

describe('pathAfterSwitch', () => {
  it('leaves an experiment from the previous account', () => {
    expect(pathAfterSwitch('/experiments/eu-central-1/EXP1')).toBe('/experiments');
    expect(pathAfterSwitch('/experiments/runs/3f8a')).toBe('/experiments');
    expect(pathAfterSwitch('/experiments')).toBeNull();
  });

  it('leaves a resource from the previous account', () => {
    expect(pathAfterSwitch('/infrastructure/rds/abc')).toBe('/infrastructure/rds');
  });

  it.each(['/pipelines/apps/a/workflows/1', '/pipelines/apps/a/runs/2'])('leaves %s', (path) => {
    expect(pathAfterSwitch(path)).toBe('/pipelines/apps/a');
  });

  it.each(['/', '/infrastructure', '/infrastructure/rds', '/pipelines', '/pipelines/apps/1'])('stays on %s', (path) => {
    expect(pathAfterSwitch(path)).toBeNull();
  });
});

describe('pipelineScope', () => {
  it('uses the environment of the selected account', () => {
    expect(pipelineScope({ environmentId: 'staging' } as CloudAccount)).toEqual({ environment: 'staging' });
  });

  it('shows only shared pipelines for an account with no environment', () => {
    expect(pipelineScope({ environmentId: null } as CloudAccount)).toEqual({ environment: 'none' });
  });

  it('does not filter when no account is selected', () => {
    expect(pipelineScope(null)).toEqual({});
  });
});
