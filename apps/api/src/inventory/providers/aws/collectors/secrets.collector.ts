import {
  ListSecretsCommand,
  SecretsManagerClient,
  type SecretListEntry,
} from '@aws-sdk/client-secrets-manager';
import type { CollectedResource, ResourceCollector } from '../../provider';
import type { AwsKey } from '../aws-key';

const toTags = (entry: SecretListEntry): Record<string, string> =>
  Object.fromEntries((entry.Tags ?? []).map(({ Key, Value }) => [Key ?? '', Value ?? '']));

const toSecretResource = (entry: SecretListEntry, region: string): CollectedResource => ({
  type: 'secrets-manager-secret',
  region,
  nativeId: entry.ARN ?? '',
  name: entry.Name ?? '',
  status: 'active',
  health: 'healthy',
  tags: toTags(entry),
  details: {
    description: entry.Description,
    lastChangedAt: entry.LastChangedDate?.toISOString(),
    rotationEnabled: entry.RotationEnabled ?? false,
    managedBy: entry.OwningService,
  },
});

export const secretsCollector: ResourceCollector<AwsKey> = {
  name: 'secrets',
  label: 'Secrets Manager',
  scope: 'regional',
  types: ['secrets-manager-secret'],
  collect: async ({ credentials, region }) => {
    const client = new SecretsManagerClient({ region, credentials });
    const resources: CollectedResource[] = [];
    let token: string | undefined;
    do {
      const { SecretList = [], NextToken } = await client.send(
        new ListSecretsCommand({ NextToken: token }),
      );
      resources.push(...SecretList.map((entry) => toSecretResource(entry, region)));
      token = NextToken;
    } while (token);
    return resources;
  },
};
