import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AwsCredentialResolver, ROLE_SESSION_NAME } from './aws-role';

const ROLE = { roleArn: 'arn:aws:iam::210987654321:role/PulseGridAccess', externalId: 'pulsegrid-abc' };
const HOUR = 3_600_000;
const sts = mockClient(STSClient);

const session = (id: string, expiresAt: number) => ({
  credentials: { accessKeyId: id, secretAccessKey: 's', sessionToken: 't', roleArn: ROLE.roleArn },
  expiresAt,
});

describe('AwsCredentialResolver', () => {
  afterEach(() => sts.reset());

  it('takes on a role once, and again only shortly before its session ends', async () => {
    const now = Date.parse('2026-11-24T10:00:00Z');
    const assume = vi
      .fn()
      .mockResolvedValueOnce(session('ASIA1', now + HOUR))
      .mockResolvedValueOnce(session('ASIA2', now + 2 * HOUR));
    const resolver = new AwsCredentialResolver(assume);

    expect((await resolver.resolve(ROLE, now)).accessKeyId).toBe('ASIA1');
    expect((await resolver.resolve(ROLE, now + 40 * 60_000)).accessKeyId).toBe('ASIA1');
    expect((await resolver.resolve(ROLE, now + 55 * 60_000)).accessKeyId).toBe('ASIA2');
    expect(assume).toHaveBeenCalledTimes(2);
  });

  it('asks STS with the External ID and a named session, and keeps the role on the credentials', async () => {
    sts.on(AssumeRoleCommand).resolves({
      Credentials: {
        AccessKeyId: 'ASIAABCDEFGHIJKLMNOP',
        SecretAccessKey: 'secret',
        SessionToken: 'token',
        Expiration: new Date(Date.now() + HOUR),
      },
    });
    const credentials = await new AwsCredentialResolver().resolve(ROLE);
    expect(sts.commandCalls(AssumeRoleCommand)[0]?.args[0].input).toMatchObject({
      RoleArn: ROLE.roleArn,
      ExternalId: ROLE.externalId,
      RoleSessionName: ROLE_SESSION_NAME,
    });
    expect(credentials).toEqual({
      accessKeyId: 'ASIAABCDEFGHIJKLMNOP',
      secretAccessKey: 'secret',
      sessionToken: 'token',
      roleArn: ROLE.roleArn,
    });
  });
});
