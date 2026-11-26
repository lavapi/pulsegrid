import { connect } from 'node:http2';
import { createPrivateKey, type KeyObject, sign } from 'node:crypto';
import type { PushEnvironment } from '../database/schema';

const HOSTS: Record<PushEnvironment, string> = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};
/** Apple accepts a provider token for an hour; a new one every 50 minutes stays inside that. */
const TOKEN_LIFETIME_MS = 50 * 60_000;
const TIMEOUT_MS = 10_000;

export interface ApnsSettings {
  keyId: string;
  teamId: string;
  bundleId: string;
  /** The .p8 key from Apple, as PEM text. */
  privateKey: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** The app screen to open when it is tapped, such as "/settings/database-access". */
  path: string;
  /** Replaces an earlier notification about the same thing instead of adding another. */
  collapseId: string;
}

/** What Apple said: sent, the phone no longer takes notifications (forget it), or anything else. */
export type PushResult = 'sent' | 'gone' | 'failed';

export type Http2Post = (
  host: string,
  path: string,
  headers: Record<string, string>,
  body: string,
) => Promise<{ status: number; body: string }>;

const base64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const http2Post: Http2Post = (host, path, headers, body) =>
  new Promise((resolve, reject) => {
    const session = connect(host);
    const fail = (error: unknown) => {
      session.close();
      reject(error instanceof Error ? error : new Error('push failed'));
    };
    session.on('error', fail);
    session.setTimeout(TIMEOUT_MS, () => fail(new Error('push timed out')));
    const stream = session.request({ ':method': 'POST', ':path': path, ...headers });
    let status = 0;
    let answer = '';
    stream.on('response', (responseHeaders) => {
      status = Number(responseHeaders[':status']);
    });
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      answer += chunk;
    });
    stream.on('end', () => {
      session.close();
      resolve({ status, body: answer });
    });
    stream.on('error', fail);
    stream.end(body);
  });

/** Sends notifications to iPhones through Apple's push service, signed with the team's key. */
export class ApnsClient {
  private readonly key: KeyObject;
  private token: { value: string; madeAt: number } | null = null;

  constructor(
    private readonly settings: ApnsSettings,
    private readonly post: Http2Post = http2Post,
  ) {
    this.key = createPrivateKey(settings.privateKey);
  }

  async send(deviceToken: string, environment: PushEnvironment, message: PushMessage): Promise<PushResult> {
    const payload = {
      aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
      path: message.path,
    };
    try {
      const { status, body } = await this.post(
        HOSTS[environment],
        `/3/device/${deviceToken}`,
        {
          authorization: `bearer ${this.providerToken()}`,
          'apns-topic': this.settings.bundleId,
          'apns-push-type': 'alert',
          'apns-collapse-id': message.collapseId.slice(0, 64),
          'content-type': 'application/json',
        },
        JSON.stringify(payload),
      );
      if (status === 200) return 'sent';
      const reason = (JSON.parse(body || '{}') as { reason?: string }).reason;
      return status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' ? 'gone' : 'failed';
    } catch {
      return 'failed';
    }
  }

  /** The signed provider token Apple asks for, made again before it gets old. */
  private providerToken(): string {
    const now = Date.now();
    if (this.token && now - this.token.madeAt < TOKEN_LIFETIME_MS) return this.token.value;
    const unsigned = `${base64url({ alg: 'ES256', kid: this.settings.keyId })}.${base64url({
      iss: this.settings.teamId,
      iat: Math.floor(now / 1000),
    })}`;
    const signature = sign('sha256', Buffer.from(unsigned), { key: this.key, dsaEncoding: 'ieee-p1363' });
    this.token = { value: `${unsigned}.${signature.toString('base64url')}`, madeAt: now };
    return this.token.value;
  }
}
