import type { CredentialField, ProviderSetup } from './cloud-providers';
import { GITHUB_PROVIDER } from './providers/github';

export interface GitProviderDefinition {
  id: string;
  label: string;
  description: string;
  icon: string;
  darkIcon?: string;
  organizationLabel: string;
  organizationHint: string;
  credentialFields: CredentialField[];
  setup: ProviderSetup;
  rerunsFailedJobs: boolean;
}

export const GIT_PROVIDERS: readonly GitProviderDefinition[] = [GITHUB_PROVIDER];

export const gitProvider = (id: string): GitProviderDefinition | undefined =>
  GIT_PROVIDERS.find((provider) => provider.id === id);

export interface GitConnection {
  id: string;
  provider: string;
  name: string;
  organization: string;
  credentialHint: string;
  status: 'connected' | 'error';
  lastError: string | null;
}

export interface GitAccessCheck {
  account: string | null;
  repositories: number;
  canRun: boolean | null;
}
