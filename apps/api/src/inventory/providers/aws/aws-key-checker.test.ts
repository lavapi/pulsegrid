import { EC2Client } from '@aws-sdk/client-ec2';
import { ECSClient } from '@aws-sdk/client-ecs';
import { ElastiCacheClient } from '@aws-sdk/client-elasticache';
import { IAMClient, PolicyEvaluationDecisionType, SimulatePrincipalPolicyCommand } from '@aws-sdk/client-iam';
import { RDSClient } from '@aws-sdk/client-rds';
import { S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { AWS_ACTIONS } from '@pulsegrid/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAwsConnection } from './aws-key-checker';
import { AwsCredentialResolver } from './aws-role';

const ROLE_ARN = 'arn:aws:iam::210987654321:role/ops/PulseGridAccess';
const ROLE = { roleArn: ROLE_ARN, externalId: 'pulsegrid-abc' };
const SESSION = { accessKeyId: 'ASIAABCDEFGHIJKLMNOP', secretAccessKey: 'b'.repeat(40), sessionToken: 't', roleArn: ROLE_ARN };
const taken = () => new AwsCredentialResolver(async () => ({ credentials: SESSION, expiresAt: Date.now() + 3_600_000 }));
const check = (resolver = taken()) => checkAwsConnection(ROLE, 'eu-central-1', resolver);

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
  });
  afterEach(() => {
    clients.forEach((client) => client.reset());
    iam.reset();
  });

  it('lists the policy actions the role lacks', async () => {
    iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions((action) => !action.startsWith('fis:Start')));
    const result = await check();
    expect(result.missingActions).toEqual(['fis:StartExperiment']);
  });

  it('reports nothing missing for the full policy', async () => {
    iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions(() => true));
    expect((await check()).missingActions).toEqual([]);
  });

  it('checks the log bucket statement against a log bucket, not every bucket', async () => {
    iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions((action) => action !== 's3:GetObject'));
    expect((await check()).missingActions).toEqual(['s3:GetObject']);
    const calls = iam.commandCalls(SimulatePrincipalPolicyCommand).map(({ args }) => args[0].input);
    expect(calls.find(({ ActionNames }) => ActionNames?.includes('s3:GetObject'))?.ResourceArns).toEqual([
      'arn:aws:s3:::example-alb-logs-000000000000/AWSLogs/example.log.gz',
    ]);
    expect(AWS_ACTIONS).not.toContain('s3:GetObject');
  });

  it("says it couldn't check when the simulator is refused", async () => {
    iam.on(SimulatePrincipalPolicyCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    const result = await check();
    expect(result).toMatchObject({ missingActions: null, canWrite: null });
  });

  it('simulates calls in the region PulseGrid calls, which organization policies limit', async () => {
    iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions(() => true));
    await check();
    const inputs = iam.commandCalls(SimulatePrincipalPolicyCommand).map(({ args }) => args[0].input);
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input.ContextEntries).toEqual([
        { ContextKeyName: 'aws:RequestedRegion', ContextKeyValues: ['eu-central-1'], ContextKeyType: 'string' },
      ]);
    }
  });

  it("is checked as the role itself, in the role's account", async () => {
    iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions(() => true));
    expect(await check()).toMatchObject({ accountId: '210987654321', missingActions: [] });
    const sources = iam.commandCalls(SimulatePrincipalPolicyCommand).map(({ args }) => args[0].input.PolicySourceArn);
    expect(new Set(sources)).toEqual(new Set([ROLE_ARN]));
  });

  it("explains a role PulseGrid can't take on, without AWS text", async () => {
    const refused = new AwsCredentialResolver(async () => {
      throw Object.assign(new Error('User: arn:aws:sts::121017505984:assumed-role/x is not authorized'), { name: 'AccessDenied' });
    });
    await expect(check(refused)).rejects.toThrow(
      "PulseGrid can't take on this role. Check that its trust policy names PulseGrid and this project's External ID.",
    );
  });
});
