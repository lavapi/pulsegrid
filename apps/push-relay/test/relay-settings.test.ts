import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, expect, it } from 'vitest';
import { loadApnsKey, readRelaySettings } from '../src/relay-settings';

const ENV = {
  TABLE_NAME: 'relay',
  APNS_KEY_PARAMETER: '/push-relay/apns-key',
  APNS_KEY_ID: 'ABC123DEFG',
  APNS_TEAM_ID: 'TEAM123456',
  APNS_BUNDLE_ID: 'com.example.app',
  NOTIFICATIONS_PER_DAY: '2000',
  REGISTRATIONS_PER_DAY: '10',
};

describe('relay settings', () => {
  it('reads everything the relay needs', () => {
    expect(readRelaySettings(ENV)).toEqual({
      table: 'relay',
      apnsKeyParameter: '/push-relay/apns-key',
      apns: { keyId: 'ABC123DEFG', teamId: 'TEAM123456', bundleId: 'com.example.app' },
      limits: { notificationsPerDay: 2000, registrationsPerDay: 10 },
    });
  });

  it('names a missing or wrong setting', () => {
    expect(() => readRelaySettings({ ...ENV, TABLE_NAME: undefined })).toThrow('TABLE_NAME is not set');
    expect(() => readRelaySettings({ ...ENV, NOTIFICATIONS_PER_DAY: '0' })).toThrow('NOTIFICATIONS_PER_DAY must be');
  });

  it('loads the Apple key decrypted, with its line breaks back', async () => {
    const ssm = mockClient(SSMClient);
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----' } });
    expect(await loadApnsKey(new SSMClient({}), '/push-relay/apns-key')).toBe('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');
    expect(ssm.commandCalls(GetParameterCommand)[0]!.args[0].input).toEqual({ Name: '/push-relay/apns-key', WithDecryption: true });
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: 'placeholder' } });
    await expect(loadApnsKey(new SSMClient({}), '/push-relay/apns-key')).rejects.toThrow('not a private key');
  });
});
