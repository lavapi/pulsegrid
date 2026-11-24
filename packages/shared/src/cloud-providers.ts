import { AWS_PROVIDER } from './providers/aws';

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
  hint?: string;
}

export type CredentialKind = 'key' | 'role';

/** One way to connect an account, such as a role to assume or an access key. */
export interface ConnectionMethod {
  id: CredentialKind;
  label: string;
  description: string;
  fields: CredentialField[];
}

/** What a role must trust so PulseGrid can take it on: its task roles, with this project's External ID. */
export interface RoleTrustDetails {
  externalId: string;
  principals: string[];
}

export interface ProviderSetup {
  title: string;
  description: string;
  code: string;
}

export interface CloudProviderDefinition {
  id: string;
  label: string;
  description: string;
  icon: string;
  darkIcon?: string;
  accountLabel: string;
  /** Ways to connect an account, the recommended one first. */
  connectionMethods: ConnectionMethod[];
  defaultRegion: string;
  regions: string[];
  setup: ProviderSetup;
}

export const CLOUD_PROVIDERS: readonly CloudProviderDefinition[] = [AWS_PROVIDER];

export const cloudProvider = (id: string): CloudProviderDefinition | undefined =>
  CLOUD_PROVIDERS.find((provider) => provider.id === id);

export const connectionMethod = (
  provider: CloudProviderDefinition,
  kind: CredentialKind,
): ConnectionMethod | undefined => provider.connectionMethods.find(({ id }) => id === kind);
