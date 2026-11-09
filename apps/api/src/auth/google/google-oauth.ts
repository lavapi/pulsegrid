export const GOOGLE_OAUTH = Symbol('GOOGLE_OAUTH');

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USER_INFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface GoogleProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface GoogleOAuth {
  authorizeUrl(state: string, redirectUri: string): string;
  profileFor(code: string, redirectUri: string): Promise<GoogleProfile>;
}

interface GoogleUser {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

export class GoogleOAuthClient implements GoogleOAuth {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  authorizeUrl(state: string, redirectUri: string): string {
    const query = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `${AUTHORIZE_URL}?${query}`;
  }

  async profileFor(code: string, redirectUri: string): Promise<GoogleProfile> {
    const tokens = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokens.ok) {
      throw new Error(`Google rejected the sign-in with status ${tokens.status}.`);
    }
    const { access_token: accessToken } = (await tokens.json()) as { access_token: string };
    const response = await fetch(USER_INFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Google profile request failed with status ${response.status}.`);
    }
    const user = (await response.json()) as GoogleUser;
    return {
      subject: user.sub,
      email: user.email,
      emailVerified: user.email_verified,
      name: user.name ?? user.email,
    };
  }
}
