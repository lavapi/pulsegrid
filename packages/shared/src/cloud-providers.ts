import { AWS_PROVIDER } from './providers/aws';

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
  hint?: string;
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
  credentialFields: CredentialField[];
  defaultRegion: string;
  regions: string[];
  setup: ProviderSetup;
}

export const CLOUD_PROVIDERS: readonly CloudProviderDefinition[] = [AWS_PROVIDER];

export const cloudProvider = (id: string): CloudProviderDefinition | undefined =>
  CLOUD_PROVIDERS.find((provider) => provider.id === id);
