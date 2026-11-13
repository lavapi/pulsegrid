import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseAccessCoreModule } from './database-access-core.module';
import { DatabaseAccessController } from './database-access.controller';
import { DatabaseAccessService } from './database-access.service';

@Module({
  imports: [AuditModule, AuthModule, DatabaseAccessCoreModule],
  controllers: [DatabaseAccessController],
  providers: [DatabaseAccessService],
})
export class DatabaseAccessModule {}
