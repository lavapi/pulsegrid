import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuditModule, TenantsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
