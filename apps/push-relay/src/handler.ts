import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SSMClient } from '@aws-sdk/client-ssm';
import { ApnsClient } from '@pulsegrid/push';
import { DynamoRelayStore } from './dynamo-relay-store';
import { type HttpEvent, type HttpResult, route, toHttpResult } from './http-routes';
import { PushRelay } from './push-relay';
import { loadApnsKey, readRelaySettings } from './relay-settings';

const UNAVAILABLE = toHttpResult({ status: 503, body: { message: 'The push relay is not available right now. Try again soon.' } });

const createRelay = async (): Promise<PushRelay> => {
  const settings = readRelaySettings(process.env);
  const privateKey = await loadApnsKey(new SSMClient({}), settings.apnsKeyParameter);
  return new PushRelay(
    new DynamoRelayStore(new DynamoDBClient({}), settings.table),
    new ApnsClient({ ...settings.apns, privateKey }),
    settings.limits,
  );
};

/** Made once per Lambda instance; a failed start is tried again on the next request. */
let relay: Promise<PushRelay> | undefined;

export const handler = async (event: HttpEvent): Promise<HttpResult> => {
  try {
    relay ??= createRelay();
    return toHttpResult(await route(await relay, event));
  } catch (error) {
    relay = undefined;
    console.warn(`The push relay failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    return UNAVAILABLE;
  }
};
