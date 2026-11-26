import { SchedulerClient } from '@aws-sdk/client-scheduler';
import { DescribeExecutionCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { mockClient } from 'aws-sdk-client-mock';
import { Secret, TOTP } from 'otpauth';
import { newTotpSecret } from '../../src/auth/two-factor/totp';
import { loadDatabaseAccessSetup } from '../../src/database-access/database-access.settings';
import { CredentialVault } from '../../src/inventory/connection/credential-vault';
import { TokenCipher } from '../../src/inventory/connection/token-cipher';
import { TEST_ROLE, type TestContext, type TestTenant } from './test-app';

export const ACCOUNT = '860000000001';
export const GRANT_ARN = `arn:aws:states:eu-central-1:${ACCOUNT}:stateMachine:db-access-grant`;
export const REVOKE_ARN = `arn:aws:states:eu-central-1:${ACCOUNT}:stateMachine:db-access-revoke`;
export const SETUP = loadDatabaseAccessSetup({
  DB_ACCESS_GRANT_STATE_MACHINE_ARN: GRANT_ARN,
  DB_ACCESS_REVOKE_STATE_MACHINE_ARN: REVOKE_ARN,
  DB_ACCESS_SCHEDULE_GROUP: 'db-access',
  DB_ACCESS_SSO_START_URL: 'https://example.awsapps.com/start',
  DB_ACCESS_TUNNEL_INSTANCE_ID: 'i-0abc',
  DB_ACCESS_READER_ENDPOINT: 'db.cluster-ro-x.eu-central-1.rds.amazonaws.com',
  DB_ACCESS_DATABASE: 'game',
});

export const sfn = mockClient(SFNClient);
export const scheduler = mockClient(SchedulerClient);

/** The workflow run ends the way the test says, and reports the end time it was given. */
export const runEnds = (status: string, extra: { error?: string; output?: object } = {}) => {
  let input: { userName?: string; expiresAt?: string } = {};
  sfn.on(StartExecutionCommand).callsFake(({ input: given }: { input: string }) => {
    input = JSON.parse(given) as typeof input;
    return { executionArn: `arn:exec:${Date.now()}` };
  });
  sfn.on(DescribeExecutionCommand).callsFake(() => ({
    status,
    error: extra.error,
    output:
      status === 'SUCCEEDED'
        ? JSON.stringify(
            extra.output ?? {
              userName: input.userName,
              userId: 'u1',
              expiresAt: input.expiresAt,
              signInsStopped: true,
            },
          )
        : undefined,
  }));
};

/** Connects the Production account to the project, which is what makes database access available there. */
export const connectProduction = async (context: TestContext, { tenant }: TestTenant): Promise<void> => {
  const production = { tenant_id: tenant.id, provider: 'aws', account_id: ACCOUNT };
  await context.owner
    .insertInto('cloud_accounts')
    .values({
      ...production,
      name: 'Production',
      regions: ['eu-central-1'],
      encrypted_credentials: context.app.get(CredentialVault).seal(production, TEST_ROLE),
    })
    .execute();
};

/**
 * Gives the person an authenticator and returns a function for a code that works now; the last used step is
 * cleared each time, so each step of a test can use one.
 */
export const authenticatorFor = async (context: TestContext, email: string): Promise<() => Promise<string>> => {
  const { id } = await context.owner.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow();
  const secret = newTotpSecret();
  await context.owner
    .updateTable('accounts')
    .set({ totp_secret: context.app.get(TokenCipher).encrypt(secret, `totp:${id}`) })
    .where('id', '=', id)
    .execute();
  return async () => {
    await context.owner.updateTable('accounts').set({ totp_last_step: null }).where('id', '=', id).execute();
    return new TOTP({ secret: Secret.fromBase32(secret), period: 30 }).generate();
  };
};
