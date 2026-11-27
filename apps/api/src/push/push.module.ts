import { Module } from '@nestjs/common';
import { PushCoreModule } from './push-core.module';
import { PushController } from './push.controller';

@Module({
  imports: [PushCoreModule],
  controllers: [PushController],
})
export class PushModule {}
