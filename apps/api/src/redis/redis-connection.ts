import Redis, { Cluster, type RedisOptions } from 'ioredis';

export type RedisClient = Redis | Cluster;

export interface RedisSettings {
  url: string;
  cluster: boolean;
  keyPrefix: string;
}

// In cluster mode every key carries one hash tag: multi-key commands (DEL of two keys, MGET, MULTI) and each BullMQ
// queue must stay in a single slot, and the tag keeps the keys apart from other applications on the same cluster.
const hashTag = (settings: RedisSettings): string => `{${settings.keyPrefix}}`;

/** BullMQ's own key prefix (it rejects ioredis' keyPrefix). Undefined keeps BullMQ's default outside a cluster. */
export const queuePrefix = (settings: RedisSettings): string | undefined =>
  settings.cluster ? hashTag(settings) : undefined;

const connectCluster = (settings: RedisSettings, options: RedisOptions, keyPrefix?: string): Cluster => {
  const url = new URL(settings.url);
  return new Cluster([{ host: url.hostname, port: Number(url.port || 6379) }], {
    keyPrefix,
    // ElastiCache's TLS certificates name the node host names, so they are kept instead of resolved to addresses.
    dnsLookup: (address, callback) => callback(null, address),
    redisOptions: {
      ...options,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
    },
  });
};

/** The application's client: get, set, del, mget and multi on its own keys. */
export const createRedisClient = (settings: RedisSettings): RedisClient =>
  settings.cluster ? connectCluster(settings, {}, `${hashTag(settings)}:`) : new Redis(settings.url);

/** A BullMQ connection: no ioredis key prefix, and requests wait for a reconnect instead of failing. */
export const createQueueConnection = (settings: RedisSettings): RedisClient =>
  settings.cluster
    ? connectCluster(settings, { maxRetriesPerRequest: null })
    : new Redis(settings.url, { maxRetriesPerRequest: null });
