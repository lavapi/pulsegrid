import {
  GetSecretValueCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { actionErrorMessage } from './aws-error-messages';
import { AWS_SECRET_STORE } from './aws-secrets';
import { secretsCollector } from './collectors/secrets.collector';

const credentials = { accessKeyId: 'a', secretAccessKey: 'b' };
const context = { credentials, region: 'eu-central-1', secretId: 'arn:secret' };
const client = mockClient(SecretsManagerClient);

beforeEach(() => client.reset());

describe('secretsCollector', () => {
  it('follows pages and keeps only details', async () => {
    client
      .on(ListSecretsCommand)
      .resolvesOnce({
        NextToken: 'more',
        SecretList: [
          {
            ARN: 'arn:one',
            Name: 'one',
            Description: 'App',
            LastChangedDate: new Date('2026-11-01T00:00:00Z'),
            RotationEnabled: true,
            OwningService: 'rds',
            Tags: [{ Key: 'team', Value: 'core' }],
          },
        ],
      })
      .resolvesOnce({ SecretList: [{ ARN: 'arn:two', Name: 'two' }] });
    const resources = await secretsCollector.collect({ credentials, region: 'eu-central-1' });
    expect(resources).toHaveLength(2);
    expect(resources[0]).toMatchObject({
      type: 'secrets-manager-secret',
      nativeId: 'arn:one',
      name: 'one',
      tags: { team: 'core' },
      details: {
        description: 'App',
        lastChangedAt: '2026-11-01T00:00:00.000Z',
        rotationEnabled: true,
        managedBy: 'rds',
      },
    });
    expect(client.commandCalls(GetSecretValueCommand)).toHaveLength(0);
  });
});

describe('AWS_SECRET_STORE', () => {
  it('reads the text and version', async () => {
    client.on(GetSecretValueCommand).resolves({ SecretString: '{"A":"1"}', VersionId: 'v1' });
    expect(await AWS_SECRET_STORE.read(context)).toEqual({ value: '{"A":"1"}', versionId: 'v1' });
  });

  it('has no text for a binary secret', async () => {
    client.on(GetSecretValueCommand).resolves({ SecretBinary: new Uint8Array([1]), VersionId: 'v1' });
    expect((await AWS_SECRET_STORE.read(context)).value).toBeNull();
  });

  it('writes a new version with its own token', async () => {
    client.on(PutSecretValueCommand).resolves({});
    await AWS_SECRET_STORE.write(context, 'new');
    const [call] = client.commandCalls(PutSecretValueCommand);
    expect(call?.args[0].input).toMatchObject({ SecretId: 'arn:secret', SecretString: 'new' });
    expect(call?.args[0].input.ClientRequestToken).toMatch(/^[\w-]{36}$/);
  });
});

describe('secret error messages', () => {
  it.each([
    ['AccessDeniedException', "This key doesn't allow that."],
    ['DecryptionFailure', "can't decrypt"],
    ['ResourceNotFoundException', 'no value yet'],
  ])('explains %s', (name, message) => {
    expect(actionErrorMessage(Object.assign(new Error('raw'), { name }))).toContain(message);
  });
});
