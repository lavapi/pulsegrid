import { randomUUID } from 'node:crypto';
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type { SecretStore } from '../provider';
import type { AwsKey } from './aws-key';

export const AWS_SECRET_STORE: SecretStore<AwsKey> = {
  resourceType: 'secrets-manager-secret',
  read: async ({ credentials, region, secretId }) => {
    const client = new SecretsManagerClient({ region, credentials });
    const { SecretString, VersionId } = await client.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );
    return { value: SecretString ?? null, versionId: VersionId ?? '' };
  },
  write: async ({ credentials, region, secretId }, value) => {
    const client = new SecretsManagerClient({ region, credentials });
    await client.send(
      new PutSecretValueCommand({
        SecretId: secretId,
        SecretString: value,
        ClientRequestToken: randomUUID(),
      }),
    );
  },
};
