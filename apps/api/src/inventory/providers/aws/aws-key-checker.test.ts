import { EC2Client } from '@aws-sdk/client-ec2';
import { ECSClient } from '@aws-sdk/client-ecs';
import { ElastiCacheClient } from '@aws-sdk/client-elasticache';
import { IAMClient, PolicyEvaluationDecisionType, SimulatePrincipalPolicyCommand } from '@aws-sdk/client-iam';
import { RDSClient } from '@aws-sdk/client-rds';
import { S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { AWS_ACTIONS } from '@pulsegrid/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAwsConnection } from './aws-key-checker';
import { AwsCredentialResolver } from './aws-role';

const KEY = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'a'.repeat(40) };
const ARN = 'arn:aws:iam::123456789012:user/pulsegrid';
interface ReadStub {
  onAnyCommand(): { resolves(output: object): unknown };
  reset(): unknown;
}

const clients: ReadStub[] = [
  mockClient(EC2Client),
  mockClient(ECSClient),
  mockClient(ElastiCacheClient),
  mockClient(RDSClient),
  mockClient(S3Client),
  mockClient(SecretsManagerClient),
];
const sts = mockClient(STSClient);
const iam = mockClient(IAMClient);

const decisions =
  (allowed: (action: string) => boolean) =>
  ({ ActionNames = [] }: { ActionNames?: string[] }) => ({
    EvaluationResults: ActionNames.map((action) => ({
      EvalActionName: action,
      EvalDecision: allowed(action) ? PolicyEvaluationDecisionType.ALLOWED : PolicyEvaluationDecisionType.IMPLICIT_DENY,
    })),
  });

describe('checkAwsConnection', () => {
  beforeEach(() => {
    clients.forEach((client) => client.onAnyCommand().resolves({}));
    sts.on(GetCallerIdentityCommand).resolves({ Account: '123456789012', Arn: ARN });
  });
  afterEach(() => {
    clients.forEach((client) => client.reset());
    sts.reset();
    iam.reset();
  });

  it('lists the policy actions a key lacks', async () => {
    iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions((action) => !action.startsWith('fis:Start')));
    const check = await checkAwsConnection(KEY, 'eu-central-1');
    expect(check.missingActions).toEqual(['fis:StartExperiment']);
  });

  it('reports nothing missing for the full policy', async () => {
    iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions(() => true));
    expect((await checkAwsConnection(KEY, 'eu-central-1')).missingActions).toEqual([]);
  });

  it('checks the log bucket statement against a log bucket, not every bucket', async () => {
    iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions((action) => action !== 's3:GetObject'));
    expect((await checkAwsConnection(KEY, 'eu-central-1')).missingActions).toEqual(['s3:GetObject']);
    const calls = iam.commandCalls(SimulatePrincipalPolicyCommand).map(({ args }) => args[0].input);
    expect(calls.find(({ ActionNames }) => ActionNames?.includes('s3:GetObject'))?.ResourceArns).toEqual([
      'arn:aws:s3:::example-alb-logs-000000000000/AWSLogs/example.log.gz',
    ]);
    expect(AWS_ACTIONS).not.toContain('s3:GetObject');
  });

  it("says it couldn't check when the simulator is refused", async () => {
    iam.on(SimulatePrincipalPolicyCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    const check = await checkAwsConnection(KEY, 'eu-central-1');
    expect(check).toMatchObject({ missingActions: null, canWrite: null });
  });

  it('simulates calls from PulseGrid\'s address, so keys locked to it check out', async () => {
    iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions(() => true));
    await checkAwsConnection(KEY, 'eu-central-1', '3.120.255.207');
    const inputs = iam.commandCalls(SimulatePrincipalPolicyCommand).map(({ args }) => args[0].input);
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input.ContextEntries).toEqual([
        { ContextKeyName: 'aws:RequestedRegion', ContextKeyValues: ['eu-central-1'], ContextKeyType: 'string' },
        { ContextKeyName: 'aws:SourceIp', ContextKeyValues: ['3.120.255.207'], ContextKeyType: 'ip' },
        { ContextKeyName: 'aws:ViaAWSService', ContextKeyValues: ['false'], ContextKeyType: 'boolean' },
      ]);
    }
  });

  it('simulates with the region alone when PulseGrid doesn\'t know its address', async () => {
    iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions(() => true));
    await checkAwsConnection(KEY, 'eu-central-1');
    expect(iam.commandCalls(SimulatePrincipalPolicyCommand)[0]?.args[0].input.ContextEntries).toEqual([
      { ContextKeyName: 'aws:RequestedRegion', ContextKeyValues: ['eu-central-1'], ContextKeyType: 'string' },
    ]);
  });

  describe('a role', () => {
    const ROLE_ARN = 'arn:aws:iam::210987654321:role/ops/PulseGridAccess';
    const role = { roleArn: ROLE_ARN, externalId: 'pulsegrid-abc' };
    const session = { accessKeyId: 'ASIAABCDEFGHIJKLMNOP', secretAccessKey: 'b'.repeat(40), sessionToken: 't', roleArn: ROLE_ARN };
    const resolver = (assume: () => Promise<{ credentials: typeof session; expiresAt: number }>) =>
      new AwsCredentialResolver(assume);

    it("is checked as the role itself, in the role's account", async () => {
      sts.on(GetCallerIdentityCommand).resolves({
        Account: '210987654321',
        Arn: 'arn:aws:sts::210987654321:assumed-role/PulseGridAccess/pulsegrid',
      });
      iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions(() => true));
      const check = await checkAwsConnection(
        role,
        'eu-central-1',
        null,
        resolver(async () => ({ credentials: session, expiresAt: Date.now() + 3_600_000 })),
      );
      expect(check).toMatchObject({ accountId: '210987654321', missingActions: [] });
      const sources = iam.commandCalls(SimulatePrincipalPolicyCommand).map(({ args }) => args[0].input.PolicySourceArn);
      expect(new Set(sources)).toEqual(new Set([ROLE_ARN]));
    });

    it("explains a role PulseGrid can't take on, without AWS text", async () => {
      const refused = resolver(async () => {
        throw Object.assign(new Error('User: arn:aws:sts::121017505984:assumed-role/x is not authorized'), { name: 'AccessDenied' });
      });
      await expect(checkAwsConnection(role, 'eu-central-1', null, refused)).rejects.toThrow(
        "PulseGrid can't take on this role. Check that its trust policy names PulseGrid and this project's External ID.",
      );
    });
  });
});

