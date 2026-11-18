import { DynamoDBClient, GetItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { Inject, Injectable } from '@nestjs/common';
import { assumedRoleCredentials } from '../common/assumed-role';
import { MESSAGES, ProductionReleaseError } from './production-releases-errors';
import { PRODUCTION_RELEASES_SETUP, type ProductionReleasesSetup } from './production-releases.settings';
import type { ReleaseItem } from './release-records';

const SESSION_NAME = 'pulsegrid-production-releases';
const MAX_SCAN_PAGES = 20;

export interface ProductionClients {
  dynamodb: DynamoDBClient;
  lambda: LambdaClient;
}

export const PRODUCTION_CLIENTS = Symbol('PRODUCTION_CLIENTS');

/** Clients that act as the production role, assumed with PulseGrid's task role; null while it isn't set up. */
export const productionClients = (setup: ProductionReleasesSetup): ProductionClients | null => {
  if (!setup) {
    return null;
  }
  const credentials = assumedRoleCredentials(setup.roleArn, setup.region, SESSION_NAME);
  return {
    dynamodb: new DynamoDBClient({ region: setup.region, credentials }),
    lambda: new LambdaClient({ region: setup.region, credentials }),
  };
};

export type DecideOutcome = { accepted: true; payload: unknown } | { accepted: false; refusal: string | undefined };

const decode = (bytes: Uint8Array | undefined): unknown => {
  try {
    return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as unknown) : null;
  } catch {
    return null;
  }
};

/** The production release table and decide function: reads, and the one call that decides. */
@Injectable()
export class ProductionReleasesAws {
  constructor(
    @Inject(PRODUCTION_CLIENTS) private readonly clients: ProductionClients | null,
    @Inject(PRODUCTION_RELEASES_SETUP) private readonly setup: ProductionReleasesSetup,
  ) {}

  async item(id: string): Promise<ReleaseItem | undefined> {
    const { clients, setup } = this.ready();
    const { Item: item } = await clients.dynamodb.send(
      new GetItemCommand({ TableName: setup.table, Key: { id: { S: id } }, ConsistentRead: true }),
    );
    return item;
  }

  async allItems(): Promise<ReleaseItem[]> {
    const { clients, setup } = this.ready();
    const items: ReleaseItem[] = [];
    let start: Record<string, NonNullable<ReleaseItem[string]>> | undefined;
    for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
      const output = await clients.dynamodb.send(new ScanCommand({ TableName: setup.table, ExclusiveStartKey: start }));
      items.push(...(output.Items ?? []));
      start = output.LastEvaluatedKey;
      if (!start) {
        break;
      }
    }
    return items;
  }

  async decide(decision: 'finish' | 'rollback', by: string): Promise<DecideOutcome> {
    const { clients, setup } = this.ready();
    const output = await clients.lambda.send(
      new InvokeCommand({
        FunctionName: setup.decideFunction,
        InvocationType: 'RequestResponse',
        Payload: new TextEncoder().encode(JSON.stringify({ decision, by })),
      }),
    );
    const payload = decode(output.Payload);
    if (output.FunctionError) {
      const message = (payload as { errorMessage?: unknown } | null)?.errorMessage;
      return { accepted: false, refusal: typeof message === 'string' ? message : undefined };
    }
    return { accepted: true, payload };
  }

  private ready(): { clients: ProductionClients; setup: NonNullable<ProductionReleasesSetup> } {
    if (!this.clients || !this.setup) {
      throw new ProductionReleaseError(MESSAGES.notSetUp);
    }
    return { clients: this.clients, setup: this.setup };
  }
}
