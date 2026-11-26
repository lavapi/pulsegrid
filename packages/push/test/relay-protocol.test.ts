import { describe, expect, it } from 'vitest';
import { parseRelayNotification, relayCredential } from '../src/relay-protocol';

const valid = {
  deviceToken: 'ab'.repeat(32),
  environment: 'production',
  message: { title: 'Database access request', body: 'Vic asks for 2 hours', path: '/settings/database-access', collapseId: 'db-1' },
};
const withMessage = (change: object) => ({ ...valid, message: { ...valid.message, ...change } });

describe('relay notifications', () => {
  it('reads a complete notification', () => {
    expect(parseRelayNotification(valid)).toEqual(valid);
  });

  it('turns down anything missing, too long or unsafe', () => {
    const invalid = [
      null,
      'text',
      { ...valid, deviceToken: 'not-a-token' },
      { ...valid, environment: 'staging' },
      { ...valid, message: undefined },
      withMessage({ title: '' }),
      withMessage({ title: 'x'.repeat(121) }),
      withMessage({ body: 'x'.repeat(501) }),
      withMessage({ path: 'https://evil.example' }),
      withMessage({ path: '//evil.example' }),
      withMessage({ path: '/a b' }),
      withMessage({ collapseId: 'x'.repeat(65) }),
    ];
    for (const body of invalid) expect(parseRelayNotification(body)).toBeNull();
  });

  it('keeps only the known fields', () => {
    expect(parseRelayNotification({ ...valid, topic: 'com.other.app', message: { ...valid.message, sound: 'x' } })).toEqual(valid);
  });

  it('joins the installation and its secret into one credential', () => {
    expect(relayCredential({ installationId: 'inst-1', secret: 's3cret' })).toBe('inst-1.s3cret');
  });
});
