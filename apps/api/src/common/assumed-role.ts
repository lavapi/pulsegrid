import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import type { AwsCredentialIdentityProvider } from '@smithy/types';

/**
 * Credentials for a role PulseGrid assumes with its own task role. The SDK asks again shortly before they expire,
 * so no access key is ever stored.
 */
export const assumedRoleCredentials = (
  roleArn: string,
  region: string,
  sessionName: string,
): AwsCredentialIdentityProvider => {
  const sts = new STSClient({ region });
  return async () => {
    const { Credentials: credentials } = await sts.send(
      new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: sessionName }),
    );
    if (!credentials?.AccessKeyId || !credentials.SecretAccessKey) {
      throw new Error('AssumeRole returned no credentials');
    }
    return {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.SessionToken,
      expiration: credentials.Expiration,
    };
  };
};
