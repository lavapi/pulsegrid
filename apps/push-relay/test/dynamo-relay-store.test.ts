import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { DynamoRelayStore } from '../src/dynamo-relay-store';

const dynamo = mockClient(DynamoDBClient);
const store = () => new DynamoRelayStore(new DynamoDBClient({}), 'relay', () => 1_000);

describe('relay table', () => {
  beforeEach(() => dynamo.reset());

  it('saves a new server once, and reads its secret hash', async () => {
    dynamo.on(GetItemCommand).resolves({ Item: { secretHash: { S: 'abc' } } });
    await store().saveInstallation('inst-1', 'abc', new Date('2026-11-26T10:00:00Z'));
    expect(dynamo.commandCalls(PutItemCommand)[0]!.args[0].input).toEqual({
      TableName: 'relay',
      Item: { pk: { S: 'installation#inst-1' }, secretHash: { S: 'abc' }, createdAt: { S: '2026-11-26T10:00:00.000Z' } },
      ConditionExpression: 'attribute_not_exists(pk)',
    });
    expect(await store().secretHashFor('inst-1')).toBe('abc');
    dynamo.on(GetItemCommand).resolves({});
    expect(await store().secretHashFor('inst-2')).toBeNull();
  });

  it('counts below the limit, with a counter that expires on its own', async () => {
    dynamo.on(UpdateItemCommand).resolves({});
    expect(await store().countToday('notifications#inst-1', '2026-11-26', 2000)).toBe(true);
    const input = dynamo.commandCalls(UpdateItemCommand)[0]!.args[0].input;
    expect(input.Key).toEqual({ pk: { S: 'count#notifications#inst-1#2026-11-26' } });
    expect(input.ExpressionAttributeValues).toMatchObject({ ':limit': { N: '2000' }, ':expiresAt': { N: String(1_000 + 172_800) } });
  });

  it('says no once the limit is reached, and passes on other failures', async () => {
    dynamo.on(UpdateItemCommand).rejects(new ConditionalCheckFailedException({ message: 'limit', $metadata: {} }));
    expect(await store().countToday('notifications#inst-1', '2026-11-26', 2000)).toBe(false);
    dynamo.on(UpdateItemCommand).rejects(new Error('throttled'));
    await expect(store().countToday('notifications#inst-1', '2026-11-26', 2000)).rejects.toThrow('throttled');
  });
});
