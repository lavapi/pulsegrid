import { createSign, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_TOPIC_ARN } from '../security-alerts.settings';
import type { SnsMessage } from '../sns-message';
import { stringToSign } from '../sns-signature';

const here = (name: string): string => join(__dirname, name);

export const TEST_CERTIFICATE = readFileSync(here('test-signing-cert.pem'), 'utf8');
const TEST_KEY = readFileSync(here('test-signing-key.pem'), 'utf8');

export const CERT_URL = 'https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-9c6465fa7f48f5cacd23014631ec1136.pem';
export const SUBSCRIBE_URL =
  'https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:eu-central-1:040496249361:security-events&Token=2336412f37fb687f5d51e6e2425c464de';

export const fixtureEvent = (name: 'security-hub-two-findings' | 'root-console-login'): Record<string, unknown> =>
  JSON.parse(readFileSync(here(`${name}.json`), 'utf8')) as Record<string, unknown>;

type Unsigned<T extends SnsMessage['Type']> = Omit<Extract<SnsMessage, { Type: T }>, 'Signature'>;

export const sign = <T extends SnsMessage>(message: Omit<T, 'Signature'>): T => {
  const algorithm = message.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256';
  const signature = createSign(algorithm)
    .update(stringToSign({ ...message, Signature: '' } as SnsMessage))
    .sign(TEST_KEY, 'base64');
  return { ...message, Signature: signature } as T;
};

const envelope = () => ({
  MessageId: randomUUID(),
  TopicArn: DEFAULT_TOPIC_ARN,
  Timestamp: new Date().toISOString(),
  SignatureVersion: '2' as const,
  SigningCertURL: CERT_URL,
});

export const notification = (event: unknown, overrides: Partial<Unsigned<'Notification'>> = {}) =>
  sign<Extract<SnsMessage, { Type: 'Notification' }>>({
    Type: 'Notification',
    Message: JSON.stringify(event),
    ...envelope(),
    ...overrides,
  } as Unsigned<'Notification'>);

export const subscriptionConfirmation = (overrides: Partial<Unsigned<'SubscriptionConfirmation'>> = {}) =>
  sign<Extract<SnsMessage, { Type: 'SubscriptionConfirmation' }>>({
    Type: 'SubscriptionConfirmation',
    Message: `You have chosen to subscribe to the topic ${DEFAULT_TOPIC_ARN}.\nTo confirm the subscription, visit the SubscribeURL included in this message.`,
    Token: '2336412f37fb687f5d51e6e2425c464de',
    SubscribeURL: SUBSCRIBE_URL,
    ...envelope(),
    ...overrides,
  });
