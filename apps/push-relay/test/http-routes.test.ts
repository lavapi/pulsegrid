import { describe, expect, it, vi } from 'vitest';
import { type HttpEvent, route, toHttpResult } from '../src/http-routes';
import type { PushRelay } from '../src/push-relay';

const OK = { status: 200, body: { result: 'sent' as const } };
const relayStub = () => ({ register: vi.fn(async () => OK), notify: vi.fn(async () => OK) });
const event = (method: string, rawPath: string, extra: Partial<HttpEvent> = {}): HttpEvent => ({
  rawPath,
  requestContext: { http: { method, sourceIp: '203.0.113.7' } },
  ...extra,
});

describe('relay routes', () => {
  it('registers a server from its address', async () => {
    const relay = relayStub();
    await route(relay as unknown as PushRelay, event('POST', '/v1/installations'));
    expect(relay.register).toHaveBeenCalledWith('203.0.113.7');
  });

  it('passes the credential and the JSON body of a notification, also when base64 encoded', async () => {
    const relay = relayStub();
    const body = JSON.stringify({ hello: 'world' });
    await route(relay as unknown as PushRelay, event('POST', '/v1/notifications', { body, headers: { authorization: 'Bearer x' } }));
    await route(
      relay as unknown as PushRelay,
      event('POST', '/v1/notifications', { body: Buffer.from(body).toString('base64'), isBase64Encoded: true }),
    );
    expect(relay.notify.mock.calls).toEqual([
      ['Bearer x', { hello: 'world' }],
      [undefined, { hello: 'world' }],
    ]);
  });

  it('turns down a body that is not JSON or is too big', async () => {
    const relay = relayStub();
    for (const body of ['not json', JSON.stringify({ big: 'x'.repeat(9000) })]) {
      expect((await route(relay as unknown as PushRelay, event('POST', '/v1/notifications', { body }))).status).toBe(400);
    }
    expect(relay.notify).not.toHaveBeenCalled();
  });

  it('knows nothing else', async () => {
    const relay = relayStub();
    expect((await route(relay as unknown as PushRelay, event('GET', '/v1/installations'))).status).toBe(404);
    expect((await route(relay as unknown as PushRelay, event('POST', '/'))).status).toBe(404);
  });

  it('answers in JSON that is never cached', () => {
    expect(toHttpResult(OK)).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: '{"result":"sent"}',
    });
  });
});
