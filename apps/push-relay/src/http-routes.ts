import { RELAY_PATHS } from '@pulsegrid/push';
import type { PushRelay, RelayResponse } from './push-relay';

/** The parts of an API Gateway HTTP API (payload 2.0) request the relay reads. */
export interface HttpEvent {
  rawPath: string;
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext: { http: { method: string; sourceIp: string } };
}

export interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const MAX_BODY_BYTES = 8 * 1024;
const NOT_FOUND: RelayResponse = { status: 404, body: { message: 'There is nothing here.' } };
const UNREADABLE: RelayResponse = { status: 400, body: { message: 'The request body must be JSON.' } };

export const toHttpResult = ({ status, body }: RelayResponse): HttpResult => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

const readJson = (event: HttpEvent): { ok: true; value: unknown } | { ok: false } => {
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
};

export const route = async (relay: PushRelay, event: HttpEvent): Promise<RelayResponse> => {
  if (event.requestContext.http.method !== 'POST') return NOT_FOUND;
  switch (event.rawPath) {
    case RELAY_PATHS.installations:
      return relay.register(event.requestContext.http.sourceIp);
    case RELAY_PATHS.notifications: {
      const body = readJson(event);
      return body.ok ? relay.notify(event.headers?.['authorization'], body.value) : UNREADABLE;
    }
    default:
      return NOT_FOUND;
  }
};
