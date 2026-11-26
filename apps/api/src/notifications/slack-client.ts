const API_ROOT = 'https://slack.com/api';
const TIMEOUT_MS = 5_000;

/** A Slack call that failed, with a sentence a person can act on; Slack's own error code is kept for logs only. */
export class SlackError extends Error {
  override readonly name = 'SlackError';

  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  invalid_auth: "Slack didn't accept this token. Copy the Bot User OAuth Token again.",
  not_authed: "Slack didn't accept this token. Copy the Bot User OAuth Token again.",
  account_inactive: 'This Slack app was removed from the workspace. Install it again.',
  token_revoked: 'This token was revoked in Slack. Install the app again and paste the new token.',
  missing_scope: 'The Slack app is missing permissions. Create it from the manifest on this page.',
  users_not_found: 'No one in Slack uses this email address.',
  ratelimited: 'Slack is busy right now. Try again in a minute.',
};
const FALLBACK = "Slack couldn't do that right now. Try again in a minute.";

export type Fetcher = typeof fetch;

/** The few Slack Web API calls PulseGrid makes with a bot token. */
export class SlackClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  /** The workspace the token belongs to. */
  async workspace(): Promise<string> {
    const { team } = await this.call<{ team?: string }>('auth.test', {});
    return team ?? 'Slack';
  }

  /** The Slack user with this email, or null when there is none. */
  async userByEmail(email: string): Promise<{ id: string; name: string } | null> {
    try {
      const { user } = await this.call<{ user: { id: string; name: string; profile?: { display_name?: string } } }>(
        'users.lookupByEmail',
        { email },
      );
      return { id: user.id, name: user.profile?.display_name || user.name };
    } catch (error) {
      if (error instanceof SlackError && error.code === 'users_not_found') {
        return null;
      }
      throw error;
    }
  }

  /** A direct message from the app to one person. */
  async message(userId: string, text: string): Promise<void> {
    await this.call('chat.postMessage', { channel: userId, text, unfurl_links: 'false', unfurl_media: 'false' });
  }

  /** Form-encoded, because Slack's read methods don't take JSON bodies. */
  private async call<T>(method: string, body: Record<string, string>): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${API_ROOT}/${method}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new SlackError(FALLBACK, 'unreachable');
    }
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
    if (!response.ok || !payload.ok) {
      const code = payload.error ?? (response.status === 429 ? 'ratelimited' : `http_${response.status}`);
      throw new SlackError(MESSAGES[code] ?? FALLBACK, code);
    }
    return payload;
  }
}
