import { createVerify } from 'node:crypto';
import type { SnsMessage } from './sns-message';

const SNS_HOST = /^sns\.[a-z]{2}(-[a-z]+)+-\d\.amazonaws\.com$/;

/** True for an https URL on an SNS host, such as https://sns.eu-central-1.amazonaws.com/. */
export const isSnsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && SNS_HOST.test(url.hostname) && url.port === '';
  } catch {
    return false;
  }
};

export const isSigningCertUrl = (value: string): boolean => isSnsUrl(value) && new URL(value).pathname.endsWith('.pem');

const NOTIFICATION_FIELDS = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] as const;
const CONFIRMATION_FIELDS = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'] as const;

/** The text SNS signs: each field's name and value on its own line, in this order, skipping fields it doesn't carry. */
export const stringToSign = (message: SnsMessage): string => {
  const fields = message.Type === 'Notification' ? NOTIFICATION_FIELDS : CONFIRMATION_FIELDS;
  const values = message as Partial<Record<string, string>>;
  return fields
    .filter((field) => values[field] !== undefined)
    .map((field) => `${field}\n${values[field]}\n`)
    .join('');
};

const ALGORITHMS = { '1': 'RSA-SHA1', '2': 'RSA-SHA256' } as const;

export const hasValidSignature = (message: SnsMessage, certificate: string): boolean => {
  try {
    return createVerify(ALGORITHMS[message.SignatureVersion])
      .update(stringToSign(message), 'utf8')
      .verify(certificate, message.Signature, 'base64');
  } catch {
    return false;
  }
};
