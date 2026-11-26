import { z } from 'zod';
import type { ApnsSettings } from '@pulsegrid/push';
import type { RedisSettings } from '../redis/redis-connection';

const envSchema = z.object({
  PUBLIC_URL: z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, '')),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  // A cluster-mode Redis or Valkey (e.g. ElastiCache with cluster mode on): connect through its configuration endpoint.
  REDIS_CLUSTER: z.enum(['true', 'false']).default('false'),
  // The hash tag every key carries in cluster mode, so the keys share a slot and stay apart from other applications.
  REDIS_KEY_PREFIX: z.string().regex(/^[a-z0-9-]+$/).default('dashops'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(8),
  API_PORT: z.coerce.number().int().positive().default(4000),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  NODE_ENV: z.string().optional(),
  // Apple push notifications for the iPhone app. Without all four, nothing is sent.
  APNS_KEY_ID: z.string().regex(/^[A-Z0-9]{10}$/).optional(),
  APNS_TEAM_ID: z.string().regex(/^[A-Z0-9]{10}$/).optional(),
  APNS_BUNDLE_ID: z.string().min(1).optional(),
  APNS_PRIVATE_KEY: z.string().includes('PRIVATE KEY').optional(),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((key) => Buffer.from(key, 'base64').length === 32, 'Must be 32 bytes in base64'),
});

export interface AppConfig {
  publicUrl: string;
  databaseUrl: string;
  redis: RedisSettings;
  sessionTtlMs: number;
  port: number;
  tokenEncryptionKey: Buffer;
  google: { clientId: string; clientSecret: string } | null;
  apns: ApnsSettings | null;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export const loadAppConfig = (env: NodeJS.ProcessEnv): AppConfig => {
  const parsed = envSchema.parse(env);
  return {
    publicUrl: parsed.PUBLIC_URL,
    databaseUrl: parsed.DATABASE_URL,
    redis: {
      url: parsed.REDIS_URL,
      cluster: parsed.REDIS_CLUSTER === 'true',
      keyPrefix: parsed.REDIS_KEY_PREFIX,
    },
    sessionTtlMs: parsed.SESSION_TTL_HOURS * 60 * 60 * 1000,
    port: parsed.API_PORT,
    tokenEncryptionKey: Buffer.from(parsed.TOKEN_ENCRYPTION_KEY, 'base64'),
    google:
      parsed.GOOGLE_CLIENT_ID && parsed.GOOGLE_CLIENT_SECRET
        ? { clientId: parsed.GOOGLE_CLIENT_ID, clientSecret: parsed.GOOGLE_CLIENT_SECRET }
        : null,
    apns:
      parsed.APNS_KEY_ID && parsed.APNS_TEAM_ID && parsed.APNS_BUNDLE_ID && parsed.APNS_PRIVATE_KEY
        ? {
            keyId: parsed.APNS_KEY_ID,
            teamId: parsed.APNS_TEAM_ID,
            bundleId: parsed.APNS_BUNDLE_ID,
            // Secrets stored as one line keep their line breaks as \n.
            privateKey: parsed.APNS_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }
        : null,
  };
};
