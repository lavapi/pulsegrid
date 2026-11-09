import { z } from 'zod';
import type { GitProvider } from '../git-provider';
import { GitHubClient } from './github-client';

const VISIBLE_SUFFIX = 4;

const credentialsSchema = z.object({ token: z.string().trim().min(20).max(400) });

const parseCredentials: GitProvider['parseCredentials'] = (input) => {
  const parsed = credentialsSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};

export const githubProvider: GitProvider = {
  id: 'github',
  parseCredentials,
  credentialHint: ({ token }) => `…${(token ?? '').slice(-VISIBLE_SUFFIX)}`,
  connect: ({ token }) => new GitHubClient(token ?? ''),
};
