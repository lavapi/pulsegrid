import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import type { AwsConnection, AwsKey } from './aws-key';

/** Every session PulseGrid starts is named so, so CloudTrail shows who acted. */
export const ROLE_SESSION_NAME = 'pulsegrid';
const SESSION_SECONDS = 3600;
const RENEW_BEFORE_MS = 10 * 60_000;

export type AssumeRole = (role: AwsConnection) => Promise<{ credentials: AwsKey; expiresAt: number }>;

const assumeWithTaskRole: AssumeRole = async ({ roleArn, externalId }) => {
  const { Credentials: credentials } = await new STSClient({}).send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      ExternalId: externalId,
      RoleSessionName: ROLE_SESSION_NAME,
      DurationSeconds: SESSION_SECONDS,
    }),
  );
  if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) {
    throw Object.assign(new Error('AssumeRole returned no credentials'), { name: 'AccessDenied' });
  }
  return {
    credentials: {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.SessionToken,
      roleArn,
    },
    expiresAt: credentials.Expiration?.getTime() ?? Date.now() + SESSION_SECONDS * 1000,
  };
};

/**
 * Turns a stored role into credentials to call AWS with: it is assumed with PulseGrid's task role and its
 * credentials kept until shortly before they expire, so most calls cost no STS call.
 */
export class AwsCredentialResolver {
  private readonly sessions = new Map<string, { credentials: AwsKey; expiresAt: number }>();

  constructor(private readonly assume: AssumeRole = assumeWithTaskRole) {}

  async resolve(connection: AwsConnection, now = Date.now()): Promise<AwsKey> {
    const key = `${connection.roleArn}|${connection.externalId}`;
    const session = this.sessions.get(key);
    if (session && session.expiresAt - RENEW_BEFORE_MS > now) {
      return session.credentials;
    }
    const fresh = await this.assume(connection);
    this.sessions.set(key, fresh);
    return fresh.credentials;
  }
}

export const AWS_CREDENTIALS = new AwsCredentialResolver();
