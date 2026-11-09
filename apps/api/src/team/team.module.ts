import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [AuditModule, TenantsModule],
  controllers: [PeopleController, TeamController, RolesController],
  providers: [PeopleService, TeamService, RolesService],
})
export class TeamModule {}
