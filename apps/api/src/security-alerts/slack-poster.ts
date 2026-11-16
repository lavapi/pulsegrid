import { Inject, Injectable } from '@nestjs/common';

const TIMEOUT_MS = 5_000;

export type PostJson = (url: string, body: unknown) => Promise<void>;

export const POST_TO_SLACK = Symbol('POST_TO_SLACK');

export class SlackPostError extends Error {
  override readonly name = 'SlackPostError';
}

export const postJson: PostJson = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  });
  if (!response.ok) {
    throw new SlackPostError(`Slack answered ${response.status}`);
  }
};

/** Posts a message to a Slack incoming webhook. */
@Injectable()
export class SlackPoster {
  constructor(@Inject(POST_TO_SLACK) private readonly post: PostJson) {}

  send(webhookUrl: string, text: string): Promise<void> {
    return this.post(webhookUrl, { text });
  }
}
