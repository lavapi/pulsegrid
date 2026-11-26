export const SESSION_COOKIE = 'devdash_session';
export const CHALLENGE_COOKIE = 'devdash_challenge';
export const GOOGLE_STATE_COOKIE = 'devdash_google_state';
/** Where to go after a Google sign-in, such as the iPhone app's hand-off page. */
export const NEXT_COOKIE = 'devdash_next';

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

export const encodeSessionCookie = (token: string): string => token;

export const decodeSessionCookie = (raw: unknown): string | null => {
  if (typeof raw !== 'string') {
    return null;
  }
  const token = raw.split('.').pop() ?? '';
  return TOKEN.test(token) ? token : null;
};
