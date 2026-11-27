import {
  ConditionalCheckFailedException,
  type DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { RelayStore } from './relay-store';

/** Counters are kept a day longer than they count, then DynamoDB removes them by itself. */
const COUNTER_LIFETIME_SECONDS = 2 * 24 * 60 * 60;

const installationKey = (installationId: string) => ({ pk: { S: `installation#${installationId}` } });

/** One DynamoDB table: an item per registered server, and an item per counter and day. */
export class DynamoRelayStore implements RelayStore {
  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly table: string,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async saveInstallation(installationId: string, secretHash: string, createdAt: Date): Promise<void> {
    await this.dynamo.send(
      new PutItemCommand({
        TableName: this.table,
        Item: { ...installationKey(installationId), secretHash: { S: secretHash }, createdAt: { S: createdAt.toISOString() } },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  }

  async secretHashFor(installationId: string): Promise<string | null> {
    const { Item } = await this.dynamo.send(
      new GetItemCommand({ TableName: this.table, Key: installationKey(installationId), ConsistentRead: true }),
    );
    return Item?.['secretHash']?.S ?? null;
  }

  async countToday(counter: string, day: string, limit: number): Promise<boolean> {
    try {
      await this.dynamo.send(
        new UpdateItemCommand({
          TableName: this.table,
          Key: { pk: { S: `count#${counter}#${day}` } },
          UpdateExpression: 'ADD #count :one SET expiresAt = if_not_exists(expiresAt, :expiresAt)',
          ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
          ExpressionAttributeNames: { '#count': 'count' },
          ExpressionAttributeValues: {
            ':one': { N: '1' },
            ':limit': { N: String(limit) },
            ':expiresAt': { N: String(this.nowSeconds() + COUNTER_LIFETIME_SECONDS) },
          },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }
}
