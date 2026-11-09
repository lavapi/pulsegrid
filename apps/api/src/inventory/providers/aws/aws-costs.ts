import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  type ResultByTime,
} from '@aws-sdk/client-cost-explorer';
import type { ServiceCategory } from '@pulsegrid/shared';
import { AWS_SERVICE_CATEGORIES } from '@pulsegrid/shared';
import type { CostEntry, CostSource } from '../provider';
import { isAccessDenied } from './aws-error-messages';
import type { AwsKey } from './aws-key';

const COST_EXPLORER_REGION = 'us-east-1';
const COST_METRIC = 'UnblendedCost';
const DEFAULT_CURRENCY = 'USD';

const DASHBOARD_SERVICES: Record<string, ServiceCategory> = {
  'Amazon Elastic Compute Cloud - Compute': 'ec2',
  'EC2 - Other': 'ec2',
  'Amazon Elastic Container Service': 'ecs',
  'Amazon Relational Database Service': 'rds',
  'Amazon ElastiCache': 'elasticache',
  'Amazon Simple Storage Service': 's3',
  'AWS Secrets Manager': 'secrets-manager',
  'Amazon Elastic Load Balancing': 'load-balancing',
  'Amazon Virtual Private Cloud': 'vpc',
};

const COST_ACCESS_DENIED =
  "This key can't read costs. Add ce:GetCostAndUsage to its IAM policy, and check that Cost Explorer is on for this account.";
const COST_NOT_READY = "AWS doesn't have cost data for this account yet.";
const COST_FAILED = "We couldn't read costs from AWS. We'll try again soon.";

const dateOf = (value: Date): string => value.toISOString().slice(0, 10);

const entriesOf = ({ TimePeriod, Groups = [] }: ResultByTime): CostEntry[] => {
  const merged = new Map<string, CostEntry>();
  const month = (TimePeriod?.Start ?? '').slice(0, 7);
  for (const { Keys = [], Metrics = {} } of Groups) {
    const name = Keys[0] ?? '';
    const category = DASHBOARD_SERVICES[name] ?? null;
    const service = category ? AWS_SERVICE_CATEGORIES[category].label : name;
    const amount = Number(Metrics[COST_METRIC]?.Amount ?? 0);
    const currency = Metrics[COST_METRIC]?.Unit ?? DEFAULT_CURRENCY;
    const entry = merged.get(service);
    merged.set(service, { month, service, category, currency, amount: (entry?.amount ?? 0) + amount });
  }
  return [...merged.values()];
};

const readPages = async (
  client: CostExplorerClient,
  input: ConstructorParameters<typeof GetCostAndUsageCommand>[0],
): Promise<ResultByTime[]> => {
  const results: ResultByTime[] = [];
  let NextPageToken: string | undefined;
  do {
    const page = await client.send(new GetCostAndUsageCommand({ ...input, NextPageToken }));
    results.push(...(page.ResultsByTime ?? []));
    NextPageToken = page.NextPageToken;
  } while (NextPageToken);
  return results;
};

const mergedByMonth = (results: ResultByTime[]): CostEntry[] => {
  const months = new Map<string, ResultByTime>();
  for (const result of results) {
    const start = result.TimePeriod?.Start ?? '';
    const known = months.get(start);
    months.set(start, {
      ...result,
      Groups: [...(known?.Groups ?? []), ...(result.Groups ?? [])],
    });
  }
  return [...months.values()].flatMap(entriesOf);
};

export const AWS_COST_SOURCE: CostSource<AwsKey> = {
  read: async ({ credentials, accountId }, { from, until }) => {
    const client = new CostExplorerClient({ region: COST_EXPLORER_REGION, credentials });
    const results = await readPages(client, {
      TimePeriod: { Start: dateOf(from), End: dateOf(until) },
      Granularity: 'MONTHLY',
      Metrics: [COST_METRIC],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: [accountId] } },
    });
    return mergedByMonth(results);
  },
  failureMessage: (error) => {
    if (isAccessDenied(error)) {
      return COST_ACCESS_DENIED;
    }
    return (error as { name?: string }).name === 'DataUnavailableException'
      ? COST_NOT_READY
      : COST_FAILED;
  },
};
