import { ListClustersCommand, ECSClient } from '@aws-sdk/client-ecs';
import { DescribeVpcsCommand, DescribeInstancesCommand, EC2Client } from '@aws-sdk/client-ec2';
import {
  DescribeCacheClustersCommand,
  ElastiCacheClient,
} from '@aws-sdk/client-elasticache';
import {
  IAMClient,
  PolicyEvaluationDecisionType,
  SimulatePrincipalPolicyCommand,
} from '@aws-sdk/client-iam';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { ListSecretsCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { AWS_ACTIONS, AWS_LOG_BUCKET_ACTIONS, AWS_SERVICES, type CredentialCheck } from '@pulsegrid/shared';
import { CredentialsRejected } from '../provider';
import { isAccessDenied, keyErrorMessage } from './aws-error-messages';
import { type AwsKey, isRootArn } from './aws-key';
import { SERVICE_PERMISSIONS } from './service-catalog';

const IAM_REGION = 'us-east-1';
const ROOT_KEY = "Root account keys aren't allowed. Create a read-only IAM user instead.";

type AwsServiceId = keyof typeof AWS_SERVICES;

interface ProbeTarget {
  credentials: AwsKey;
  region: string;
}

const READ_PROBES: Record<AwsServiceId, (target: ProbeTarget) => Promise<unknown>> = {
  ecs: ({ credentials, region }) =>
    new ECSClient({ region, credentials }).send(new ListClustersCommand({ maxResults: 1 })),
  rds: ({ credentials, region }) =>
    new RDSClient({ region, credentials }).send(new DescribeDBInstancesCommand({ MaxRecords: 20 })),
  elasticache: ({ credentials, region }) =>
    new ElastiCacheClient({ region, credentials }).send(
      new DescribeCacheClustersCommand({ MaxRecords: 20 }),
    ),
  s3: ({ credentials, region }) =>
    new S3Client({ region, credentials }).send(new ListBucketsCommand({})),
  secrets: ({ credentials, region }) =>
    new SecretsManagerClient({ region, credentials }).send(new ListSecretsCommand({ MaxResults: 1 })),
  ec2: ({ credentials, region }) =>
    new EC2Client({ region, credentials }).send(new DescribeInstancesCommand({ MaxResults: 5 })),
  network: ({ credentials, region }) =>
    new EC2Client({ region, credentials }).send(new DescribeVpcsCommand({ MaxResults: 5 })),
};

const canRead = async (service: AwsServiceId, target: ProbeTarget): Promise<boolean> => {
  try {
    await READ_PROBES[service](target);
    return true;
  } catch (error) {
    return !isAccessDenied(error);
  }
};

/** The actions the simulator allows, or null when the credentials can't run the simulator. */
const allowedActions = async (
  credentials: AwsKey,
  arn: string,
  actions: readonly string[],
  resourceArns?: string[],
) => {
  const client = new IAMClient({ region: IAM_REGION, credentials });
  try {
    const { EvaluationResults: results } = await client.send(
      new SimulatePrincipalPolicyCommand({ PolicySourceArn: arn, ActionNames: [...actions], ResourceArns: resourceArns }),
    );
    return new Set(
      (results ?? [])
        .filter(({ EvalDecision: decision }) => decision === PolicyEvaluationDecisionType.ALLOWED)
        .flatMap(({ EvalActionName: action }) => (action ? [action] : [])),
    );
  } catch {
    return null;
  }
};

const canWrite = async (credentials: AwsKey, arn: string): Promise<boolean | null> => {
  const allowed = await allowedActions(
    credentials,
    arn,
    SERVICE_PERMISSIONS.map(({ manageAction }) => manageAction),
  );
  return allowed && allowed.size > 0;
};

/** A bucket and file named like load balancer logs, to test the policy's statement that is limited to them. */
const SAMPLE_LOG_BUCKET = 'arn:aws:s3:::example-alb-logs-000000000000';

const missingActions = async (credentials: AwsKey, arn: string): Promise<string[] | null> => {
  const [allowed, bucket, file] = await Promise.all([
    allowedActions(credentials, arn, AWS_ACTIONS),
    allowedActions(credentials, arn, ['s3:ListBucket'], [SAMPLE_LOG_BUCKET]),
    allowedActions(credentials, arn, ['s3:GetObject'], [`${SAMPLE_LOG_BUCKET}/AWSLogs/example.log.gz`]),
  ]);
  if (!allowed || !bucket || !file) {
    return null;
  }
  const logBucket = new Set([...bucket, ...file]);
  return [
    ...AWS_ACTIONS.filter((action) => !allowed.has(action)),
    ...AWS_LOG_BUCKET_ACTIONS.filter((action) => !logBucket.has(action)),
  ];
};

const identityOf = async (credentials: AwsKey) => {
  try {
    return await new STSClient({ region: IAM_REGION, credentials }).send(
      new GetCallerIdentityCommand({}),
    );
  } catch (error) {
    throw new CredentialsRejected(keyErrorMessage(error));
  }
};

export const checkAwsKey = async (key: AwsKey, region: string): Promise<CredentialCheck> => {
  const identity = await identityOf(key);
  const arn = identity.Arn ?? '';
  if (isRootArn(arn)) {
    throw new CredentialsRejected(ROOT_KEY);
  }
  const services = await Promise.all(
    SERVICE_PERMISSIONS.map(async ({ service }) => ({
      service,
      label: AWS_SERVICES[service],
      readable: await canRead(service, { credentials: key, region }),
    })),
  );
  return {
    accountId: identity.Account ?? '',
    services,
    canWrite: await canWrite(key, arn),
    missingActions: await missingActions(key, arn),
  };
};
