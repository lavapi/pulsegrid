import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseAccessCoreModule } from './database-access-core.module';
import { DatabaseAccessRequestsController } from './database-access-requests.controller';
import { DatabaseAccessRequestsService } from './database-access-requests.service';
import { DatabaseAccessRequestsStore } from './database-access-requests.store';
import { DatabaseAccessController } from './database-access.controller';
import { DatabaseAccessService } from './database-access.service';

@Module({
  imports: [AuditModule, AuthModule, DatabaseAccessCoreModule],
  controllers: [DatabaseAccessRequestsController, DatabaseAccessController],
  providers: [DatabaseAccessService, DatabaseAccessRequestsService, DatabaseAccessRequestsStore],
})
export class DatabaseAccessModule {}
