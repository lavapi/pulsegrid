import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { NotificationsCoreModule } from './notifications-core.module';
import { MyNotificationsController, SlackAppController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [AuditModule, AuthModule, NotificationsCoreModule, PipelinesModule],
  controllers: [SlackAppController, MyNotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
