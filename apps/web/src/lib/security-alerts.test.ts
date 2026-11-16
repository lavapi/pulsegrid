import { describe, expect, it } from 'vitest';
import { accountLabel, alertFacts, alertQuery, severityLabel } from './security-alerts';

describe('security alerts', () => {
  it('builds the API query from the filters, covering whole days', () => {
    expect(alertQuery({ severity: 'HIGH', region: '', from: '2026-11-01', to: '2026-11-16', other: 'x' }).toString()).toBe(
      'severity=HIGH&from=2026-11-01&to=2026-11-16T23%3A59%3A59.999Z',
    );
  });

  it('names accounts when their name is known', () => {
    expect(accountLabel({ accountId: '768807471283', accountName: 'Management' })).toBe('Management (768807471283)');
    expect(accountLabel({ accountId: '111122223333', accountName: null })).toBe('111122223333');
  });

  it('writes severities in sentence case', () => {
    expect(severityLabel('INFORMATIONAL')).toBe('Informational');
  });

  it('lists only the facts AWS sent', () => {
    expect(alertFacts({ eventName: 'ConsoleLogin', consoleLogin: 'Success', resourceIds: ['a', 'b'] })).toEqual([
      { label: 'Action', value: 'ConsoleLogin' },
      { label: 'Sign-in result', value: 'Success' },
      { label: 'Resources', value: 'a\nb' },
    ]);
  });
});
