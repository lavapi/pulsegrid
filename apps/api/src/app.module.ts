import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { SlowRequestInterceptor } from './common/slow-request.interceptor';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { InventoryModule } from './inventory/inventory.module';
import { PipelinesModule } from './pipelines/pipelines.module';
import { RedisModule } from './redis/redis.module';
import { ReleasesModule } from './releases/releases.module';
import { ProjectsModule } from './projects/projects.module';
import { TeamModule } from './team/team.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    AuditModule,
    AuthModule,
    ProjectsModule,
    TeamModule,
    InventoryModule,
    PipelinesModule,
    ReleasesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: SlowRequestInterceptor }],
})
export class AppModule {}
