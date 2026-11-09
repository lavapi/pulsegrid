import { Cluster } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createQueueConnection,
  createRedisClient,
  queuePrefix,
  type RedisClient,
  type RedisSettings,
} from './redis-connection';

const cluster: RedisSettings = {
  url: 'rediss://:s3cr%40t@clustercfg.cache.example.internal:6379',
  cluster: true,
  keyPrefix: 'dashops',
};
const single: RedisSettings = { url: 'redis://localhost:6390/1', cluster: false, keyPrefix: 'dashops' };

const clients: RedisClient[] = [];
const track = (client: RedisClient): RedisClient => {
  clients.push(client);
  return client;
};

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.disconnect();
  }
});

describe('redis connection', () => {
  it('tags every application key with one hash tag in cluster mode', () => {
    const client = track(createRedisClient(cluster)) as Cluster;

    expect(client).toBeInstanceOf(Cluster);
    expect(client.options.keyPrefix).toBe('{dashops}:');
    expect(client.options.redisOptions?.password).toBe('s3cr@t');
    expect(client.options.redisOptions?.tls).toEqual({});
  });

  it('gives BullMQ a cluster connection without an ioredis prefix and its own hash-tagged prefix', () => {
    const connection = track(createQueueConnection(cluster)) as Cluster;

    expect(connection.options.keyPrefix).toBeUndefined();
    expect(connection.options.redisOptions?.maxRetriesPerRequest).toBeNull();
    expect(queuePrefix(cluster)).toBe('{dashops}');
  });

  it('keeps a single-node connection and BullMQ default prefix outside a cluster', () => {
    const client = track(createRedisClient(single));

    expect(client).not.toBeInstanceOf(Cluster);
    expect(client.options.keyPrefix).toBeFalsy();
    expect(queuePrefix(single)).toBeUndefined();
  });
});
