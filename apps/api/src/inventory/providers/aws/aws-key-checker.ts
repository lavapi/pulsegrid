import { ListClustersCommand, ECSClient } from '@aws-sdk/client-ecs';
import { DescribeVpcsCommand, DescribeInstancesCommand, EC2Client } from '@aws-sdk/client-ec2';
import {
  DescribeCacheClustersCommand,
  ElastiCacheClient,
} from '@aws-sdk/client-elasticache';
import {
  type ContextEntry,
  ContextKeyTypeEnum,
  IAMClient,
  PolicyEvaluationDecisionType,
  SimulatePrincipalPolicyCommand,
} from '@aws-sdk/client-iam';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { ListSecretsCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { AWS_ACTIONS, AWS_LOG_BUCKET_ACTIONS, AWS_SERVICES, type CredentialCheck } from '@pulsegrid/shared';
import { CredentialsRejected } from '../provider';
import { isAccessDenied } from './aws-error-messages';
import { type AwsConnection, type AwsKey, roleParts } from './aws-key';
import { AWS_CREDENTIALS, type AwsCredentialResolver } from './aws-role';
import { SERVICE_PERMISSIONS } from './service-catalog';

const IAM_REGION = 'us-east-1';
const ROLE_NOT_TRUSTED =
  "PulseGrid can't take on this role. Check that its trust policy names PulseGrid and this project's External ID.";

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

/**
 * The simulator only knows what a request carries when told. PulseGrid's calls name their region, so organization
 * policies that limit regions check out as they really work.
 */
const requestContext = (region: string): ContextEntry[] => [
  { ContextKeyName: 'aws:RequestedRegion', ContextKeyValues: [region], ContextKeyType: ContextKeyTypeEnum.STRING },
];

/** The actions the simulator allows, or null when the credentials can't run the simulator. */
const allowedActions = async (
  credentials: AwsKey,
  arn: string,
  region: string,
  actions: readonly string[],
  resourceArns?: string[],
) => {
  const client = new IAMClient({ region: IAM_REGION, credentials });
  try {
    const { EvaluationResults: results } = await client.send(
      new SimulatePrincipalPolicyCommand({
        PolicySourceArn: arn,
        ActionNames: [...actions],
        ResourceArns: resourceArns,
        ContextEntries: requestContext(region),
      }),
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

const canWrite = async (credentials: AwsKey, arn: string, region: string): Promise<boolean | null> => {
  const allowed = await allowedActions(
    credentials,
    arn,
    region,
    SERVICE_PERMISSIONS.map(({ manageAction }) => manageAction),
  );
  return allowed && allowed.size > 0;
};

/** A bucket and file named like load balancer logs, to test the policy's statement that is limited to them. */
const SAMPLE_LOG_BUCKET = 'arn:aws:s3:::example-alb-logs-000000000000';

const missingActions = async (credentials: AwsKey, arn: string, region: string): Promise<string[] | null> => {
  const [allowed, bucket, file] = await Promise.all([
    allowedActions(credentials, arn, region, AWS_ACTIONS),
    allowedActions(credentials, arn, region, ['s3:ListBucket'], [SAMPLE_LOG_BUCKET]),
    allowedActions(credentials, arn, region, ['s3:GetObject'], [`${SAMPLE_LOG_BUCKET}/AWSLogs/example.log.gz`]),
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

/** Credentials to check with: the role taken on with PulseGrid's task role. */
const credentialsFor = async (connection: AwsConnection, resolver: AwsCredentialResolver): Promise<AwsKey> => {
  try {
    return await resolver.resolve(connection);
  } catch {
    throw new CredentialsRejected(ROLE_NOT_TRUSTED);
  }
};

/**
 * Takes the role on, then checks what it can read and do. The simulator runs against the role's own ARN, since it
 * doesn't take the temporary sessions a role gives.
 */
export const checkAwsConnection = async (
  connection: AwsConnection,
  region: string,
  resolver: AwsCredentialResolver = AWS_CREDENTIALS,
): Promise<CredentialCheck> => {
  const credentials = await credentialsFor(connection, resolver);
  const { roleArn } = connection;
  const services = await Promise.all(
    SERVICE_PERMISSIONS.map(async ({ service }) => ({
      service,
      label: AWS_SERVICES[service],
      readable: await canRead(service, { credentials, region }),
    })),
  );
  return {
    accountId: roleParts(roleArn)?.accountId ?? '',
    services,
    canWrite: await canWrite(credentials, roleArn, region),
    missingActions: await missingActions(credentials, roleArn, region),
  };
};
