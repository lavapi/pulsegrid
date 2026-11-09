import { describe, expect, it } from 'vitest';
import { detectEnvironment } from './environment-detection';

describe('detectEnvironment', () => {
  it.each([
    ['Production', 'Production'],
    ['acme-prod', 'Production'],
    ['Staging', 'Staging'],
    ['STG eu', 'Staging'],
    ['dev-sandbox', 'Development'],
    ['UAT', 'QA'],
  ])('reads %s as %s', (account, expected) => {
    expect(detectEnvironment(account)?.name).toBe(expected);
  });

  it.each(['Audit', 'Backup', 'Log Archive', 'Product team', 'Devices'])(
    'leaves %s alone',
    (account) => {
      expect(detectEnvironment(account)).toBeNull();
    },
  );
});
