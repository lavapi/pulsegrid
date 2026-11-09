import { Module } from '@nestjs/common';
import { ProjectDirectory } from './project-directory';
import { TenantsService } from './tenants.service';

@Module({ providers: [ProjectDirectory, TenantsService], exports: [ProjectDirectory, TenantsService] })
export class TenantsModule {}
