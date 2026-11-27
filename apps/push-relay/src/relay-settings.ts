import { GetParameterCommand, type SSMClient } from '@aws-sdk/client-ssm';
import type { ApnsSettings } from '@pulsegrid/push';
import type { RelayLimits } from './push-relay';

export interface RelaySettings {
  table: string;
  /** The Parameter Store name of the Apple .p8 key, kept encrypted. */
  apnsKeyParameter: string;
  apns: Omit<ApnsSettings, 'privateKey'>;
  limits: RelayLimits;
}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const positive = (env: NodeJS.ProcessEnv, name: string): number => {
  const value = Number(required(env, name));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a whole number above 0`);
  return value;
};

export const readRelaySettings = (env: NodeJS.ProcessEnv): RelaySettings => ({
  table: required(env, 'TABLE_NAME'),
  apnsKeyParameter: required(env, 'APNS_KEY_PARAMETER'),
  apns: { keyId: required(env, 'APNS_KEY_ID'), teamId: required(env, 'APNS_TEAM_ID'), bundleId: required(env, 'APNS_BUNDLE_ID') },
  limits: {
    notificationsPerDay: positive(env, 'NOTIFICATIONS_PER_DAY'),
    registrationsPerDay: positive(env, 'REGISTRATIONS_PER_DAY'),
  },
});

export const loadApnsKey = async (ssm: SSMClient, name: string): Promise<string> => {
  const { Parameter } = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const key = Parameter?.Value?.replace(/\\n/g, '\n');
  if (!key?.includes('PRIVATE KEY')) throw new Error('The Apple key in Parameter Store is not a private key');
  return key;
};
