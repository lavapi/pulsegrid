import type { PushEnvironment, PushMessage, PushResult } from './push-sender';

/** How PulseGrid servers without their own Apple key talk to the push relay. */
export const RELAY_PATHS = {
  installations: '/v1/installations',
  notifications: '/v1/notifications',
} as const;

/** What a server gets once when it registers, and sends back with every notification. */
export interface RelayInstallation {
  installationId: string;
  secret: string;
}

export interface RelayNotification {
  deviceToken: string;
  environment: PushEnvironment;
  message: PushMessage;
}

export interface RelayAnswer {
  result: PushResult;
}

export const RELAY_LIMITS = {
  title: 120,
  body: 500,
  path: 200,
  collapseId: 64,
} as const;

export const relayCredential = ({ installationId, secret }: RelayInstallation): string => `${installationId}.${secret}`;

const DEVICE_TOKEN = /^[0-9a-f]{64,200}$/;
const APP_PATH = /^\/(?![/\\])[^\s\\]*$/;
const ENVIRONMENTS: readonly string[] = ['sandbox', 'production'] satisfies PushEnvironment[];

const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit;

/** The notification in a request body, or null when anything in it is missing, too long or unsafe. */
export const parseRelayNotification = (value: unknown): RelayNotification | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { deviceToken, environment, message } = value as Record<string, unknown>;
  if (typeof message !== 'object' || message === null) return null;
  const { title, body, path, collapseId } = message as Record<string, unknown>;
  const valid =
    typeof deviceToken === 'string' &&
    DEVICE_TOKEN.test(deviceToken) &&
    typeof environment === 'string' &&
    ENVIRONMENTS.includes(environment) &&
    text(title, RELAY_LIMITS.title) &&
    text(body, RELAY_LIMITS.body) &&
    text(path, RELAY_LIMITS.path) &&
    APP_PATH.test(path) &&
    text(collapseId, RELAY_LIMITS.collapseId);
  return valid
    ? { deviceToken, environment: environment as PushEnvironment, message: { title, body, path, collapseId } }
    : null;
};
