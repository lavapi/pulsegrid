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
import { checkAwsKey } from './aws-key-checker';

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

describe('checkAwsKey', () => {
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
    const check = await checkAwsKey(KEY, 'eu-central-1');
    expect(check.missingActions).toEqual(['fis:StartExperiment']);
  });

  it('reports nothing missing for the full policy', async () => {
    iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions(() => true));
    expect((await checkAwsKey(KEY, 'eu-central-1')).missingActions).toEqual([]);
  });

  it('checks the log bucket statement against a log bucket, not every bucket', async () => {
    iam.on(SimulatePrincipalPolicyCommand).callsFake(decisions((action) => action !== 's3:GetObject'));
    expect((await checkAwsKey(KEY, 'eu-central-1')).missingActions).toEqual(['s3:GetObject']);
    const calls = iam.commandCalls(SimulatePrincipalPolicyCommand).map(({ args }) => args[0].input);
    expect(calls.find(({ ActionNames }) => ActionNames?.includes('s3:GetObject'))?.ResourceArns).toEqual([
      'arn:aws:s3:::example-alb-logs-000000000000/AWSLogs/example.log.gz',
    ]);
    expect(AWS_ACTIONS).not.toContain('s3:GetObject');
  });

  it("says it couldn't check when the simulator is refused", async () => {
    iam.on(SimulatePrincipalPolicyCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    const check = await checkAwsKey(KEY, 'eu-central-1');
    expect(check).toMatchObject({ missingActions: null, canWrite: null });
  });
});
