import { Module } from '@nestjs/common';
import { PushCoreModule } from './push-core.module';
import { NotificationSettingsController } from './notification-settings.controller';
import { PushController } from './push.controller';

@Module({
  imports: [PushCoreModule],
  controllers: [NotificationSettingsController, PushController],
})
export class PushModule {}
