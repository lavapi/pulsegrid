import { z } from 'zod';
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
  };
};
