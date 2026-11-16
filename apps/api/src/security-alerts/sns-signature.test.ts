import { describe, expect, it } from 'vitest';
import { notification, subscriptionConfirmation, TEST_CERTIFICATE } from './fixtures/sns-fixtures';
import { hasValidSignature, isSigningCertUrl, isSnsUrl, stringToSign } from './sns-signature';

describe('SNS signatures', () => {
  it.each(['1', '2'] as const)('accepts a message signed with SignatureVersion %s', (version) => {
    expect(hasValidSignature(notification({ id: 'event' }, { SignatureVersion: version }), TEST_CERTIFICATE)).toBe(true);
  });

  it('refuses a message changed after signing', () => {
    const signed = notification({ id: 'event', 'detail-type': 'Test' });
    expect(hasValidSignature({ ...signed, Message: signed.Message.replace('Test', 'Fake') }, TEST_CERTIFICATE)).toBe(false);
    expect(hasValidSignature({ ...signed, TopicArn: `${signed.TopicArn}-other` }, TEST_CERTIFICATE)).toBe(false);
  });

  it('refuses a version 1 signature presented as version 2', () => {
    const signed = notification({ id: 'event' }, { SignatureVersion: '1' });
    expect(hasValidSignature({ ...signed, SignatureVersion: '2' }, TEST_CERTIFICATE)).toBe(false);
  });

  it('accepts a signed subscription confirmation', () => {
    expect(hasValidSignature(subscriptionConfirmation(), TEST_CERTIFICATE)).toBe(true);
  });

  it('signs a confirmation over its link and token, in the order SNS uses', () => {
    const message = subscriptionConfirmation();
    expect(stringToSign(message)).toBe(
      [
        `Message\n${message.Message}`,
        `MessageId\n${message.MessageId}`,
        `SubscribeURL\n${message.SubscribeURL}`,
        `Timestamp\n${message.Timestamp}`,
        `Token\n${message.Token}`,
        `TopicArn\n${message.TopicArn}`,
        'Type\nSubscriptionConfirmation\n',
      ].join('\n'),
    );
  });

  it('includes the subject only when the notification has one', () => {
    expect(stringToSign(notification({}))).not.toContain('Subject');
    expect(stringToSign(notification({}, { Subject: 'Alert' }))).toContain('Subject\nAlert\n');
  });

  it.each([
    ['https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-abc.pem', true],
    ['https://sns.us-gov-west-1.amazonaws.com/cert.pem', true],
    ['http://sns.eu-central-1.amazonaws.com/cert.pem', false],
    ['https://sns.eu-central-1.amazonaws.com.attacker.test/cert.pem', false],
    ['https://attacker.test/sns.eu-central-1.amazonaws.com/cert.pem', false],
    ['https://sns.eu-central-1.amazonaws.com:8443/cert.pem', false],
    ['https://sns.eu-central-1.amazonaws.com/cert.txt', false],
    ['not a url', false],
  ])('checks that %s is an SNS signing certificate: %s', (url, expected) => {
    expect(isSigningCertUrl(url)).toBe(expected);
  });

  it('allows confirmation links only on SNS hosts', () => {
    expect(isSnsUrl('https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription')).toBe(true);
    expect(isSnsUrl('https://example.test/?Action=ConfirmSubscription')).toBe(false);
  });
});
