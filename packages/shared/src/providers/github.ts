import type { GitProviderDefinition } from '../git-providers';

const SETUP = `Create a fine-grained personal access token on GitHub:

Resource owner: your organization
Repository access: All repositories, or the ones you need

Repository permissions:
  Actions: Read and write
  Contents: Read-only
  Metadata: Read-only`;

export const GITHUB_PROVIDER: GitProviderDefinition = {
  id: 'github',
  label: 'GitHub',
  description: 'See and run GitHub Actions pipelines',
  icon: '/git-icons/github.svg',
  darkIcon: '/git-icons/github-dark.svg',
  organizationLabel: 'Organization',
  organizationHint: 'As it appears in the GitHub URL',
  credentialFields: [
    {
      key: 'token',
      label: 'Access token',
      secret: true,
      hint: 'Stored encrypted, and never shown again',
    },
  ],
  setup: {
    title: 'Token permissions',
    description: 'Use a dedicated token with only the access the dashboard needs.',
    code: SETUP,
  },
  rerunsFailedJobs: true,
};
