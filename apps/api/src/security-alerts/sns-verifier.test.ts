import { describe, expect, it, vi } from 'vitest';
import { CERT_URL, notification, TEST_CERTIFICATE } from './fixtures/sns-fixtures';
import { loadSecurityAlertsSettings } from './security-alerts.settings';
import { SigningCertificates } from './signing-certificates';
import { SnsVerifier } from './sns-verifier';

const setup = (env: NodeJS.ProcessEnv = {}) => {
  const download = vi.fn(async () => TEST_CERTIFICATE);
  const verifier = new SnsVerifier(new SigningCertificates(download), loadSecurityAlertsSettings(env));
  return { verifier, download };
};

const body = (message: unknown) => JSON.stringify(message);

describe('SnsVerifier', () => {
  it('accepts a signed message from the allowed topic', async () => {
    const { verifier } = setup();
    const result = await verifier.verify(body(notification({ id: 'event' })));
    expect(result).toMatchObject({ verified: true, message: { Type: 'Notification' } });
  });

  it('refuses topics outside the allowlist without downloading a certificate', async () => {
    const { verifier, download } = setup();
    const other = notification({}, { TopicArn: 'arn:aws:sns:eu-central-1:111122223333:security-events' });
    expect(await verifier.verify(body(other))).toEqual({
      verified: false,
      reason: 'topic arn:aws:sns:eu-central-1:111122223333:security-events is not allowed',
    });
    expect(download).not.toHaveBeenCalled();
  });

  it('accepts every topic in the setting', async () => {
    const other = 'arn:aws:sns:eu-west-1:111122223333:alerts';
    const { verifier } = setup({ SECURITY_ALERTS_TOPIC_ARNS: `arn:aws:sns:eu-central-1:040496249361:security-events, ${other}` });
    expect(await verifier.verify(body(notification({}, { TopicArn: other })))).toMatchObject({ verified: true });
  });

  it('refuses messages more than an hour old', async () => {
    const { verifier } = setup();
    const old = notification({}, { Timestamp: new Date(Date.now() - 61 * 60_000).toISOString() });
    expect(await verifier.verify(body(old))).toEqual({ verified: false, reason: 'the message is more than an hour old' });
  });

  it('refuses a certificate outside SNS', async () => {
    const { verifier, download } = setup();
    const message = notification({}, { SigningCertURL: 'https://attacker.test/cert.pem' });
    expect(await verifier.verify(body(message))).toMatchObject({ verified: false });
    expect(download).not.toHaveBeenCalled();
  });

  it('refuses a tampered message', async () => {
    const { verifier } = setup();
    const signed = notification({ id: 'event' });
    expect(await verifier.verify(body({ ...signed, Message: '{"id":"other"}' }))).toEqual({
      verified: false,
      reason: 'the signature does not match',
    });
  });

  it('refuses text that is not an SNS message', async () => {
    const { verifier } = setup();
    expect(await verifier.verify('hello')).toEqual({ verified: false, reason: 'it is not an SNS message' });
    expect(await verifier.verify(body({ Type: 'Notification' }))).toMatchObject({ verified: false });
  });

  it('downloads each certificate once', async () => {
    const { verifier, download } = setup();
    await verifier.verify(body(notification({})));
    await verifier.verify(body(notification({})));
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(CERT_URL);
  });
});

describe('security alert settings', () => {
  it('reads account names and defaults the topic', () => {
    const settings = loadSecurityAlertsSettings({
      SECURITY_ALERTS_PROJECT: 'acme',
      SECURITY_ALERTS_ACCOUNT_NAMES: '768807471283=Management, 078212790620=Log Archive',
    });
    expect(settings.projectSlug).toBe('acme');
    expect([...settings.topicArns]).toEqual(['arn:aws:sns:eu-central-1:040496249361:security-events']);
    expect(settings.accountNames.get('078212790620')).toBe('Log Archive');
  });

  it('names the setting that is wrong', () => {
    expect(() => loadSecurityAlertsSettings({ SECURITY_ALERTS_TOPIC_ARNS: 'not-an-arn' })).toThrow(
      'Check these settings: SECURITY_ALERTS_TOPIC_ARNS',
    );
  });
});
