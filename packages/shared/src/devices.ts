/** The scheme the iPhone app opens with; sign-in in the browser hands back to it. */
export const APP_URL_SCHEME = 'pulsegrid';

/** How long the iPhone app stays signed in without being used. Each use extends it. */
export const DEVICE_SESSION_DAYS = 30;

/** A phone signed in to the iPhone app, listed so its owner can sign it out. */
export interface SignedInDevice {
  id: string;
  name: string;
  signedInAt: string;
  lastUsedAt: string | null;
  /** Whether this is the device asking. */
  current: boolean;
}

export interface DeviceSignInCode {
  code: string;
}

export interface DeviceToken {
  token: string;
  expiresAt: string;
}

/** Where sign-in may send someone afterwards: a path on this site only, never another site. */
export const safeNext = (value: unknown): string | null =>
  typeof value === 'string' && /^\/(?![/\\])[^\s\\]{0,500}$/.test(value) ? value : null;
