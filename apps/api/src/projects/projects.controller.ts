import type { Project, ProjectList } from '@pulsegrid/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AllowNoProject, RequireProject } from '../auth/guards/allow-no-project.decorator';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { CurrentPerson } from '../auth/guards/current-person.decorator';
import { RequireOwner } from '../auth/guards/require-owner.decorator';
import type { AuthContext, PersonContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ProjectsService } from './projects.service';

const projectSchema = z.object({ name: z.string().trim().min(1).max(60) });
const deleteSchema = z.object({ confirmName: z.string().max(100) });
const INVALID_PROJECT = 'Enter a project name up to 60 characters.';
const INVALID_CONFIRMATION = 'Type the project name to confirm.';

@Controller('projects')
@AllowNoProject()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentPerson() person: PersonContext): Promise<ProjectList> {
    return this.projects.list(person);
  }

  @Post()
  @RequireOwner()
  create(
    @CurrentPerson() person: PersonContext,
    @Body(new ZodPipe(projectSchema, INVALID_PROJECT)) body: z.infer<typeof projectSchema>,
    @Req() request: Request,
  ): Promise<Project> {
    return this.projects.create(person, body.name, request.ip);
  }

  @Put('current')
  @RequireProject()
  @RequireOwner()
  rename(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(projectSchema, INVALID_PROJECT)) body: z.infer<typeof projectSchema>,
    @Req() request: Request,
  ): Promise<Project> {
    return this.projects.rename(auth, body.name, request.ip);
  }

  @Delete('current')
  @RequireProject()
  @RequireOwner()
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(deleteSchema, INVALID_CONFIRMATION)) body: z.infer<typeof deleteSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.projects.remove(auth, body.confirmName, request.ip);
  }

  @Post(':id/select')
  @HttpCode(204)
  select(@CurrentPerson() person: PersonContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.projects.select(person, id);
  }
}
