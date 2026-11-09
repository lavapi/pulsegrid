import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { createRedisClient, type RedisClient } from './redis-connection';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createRedisClient(config.redis),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
