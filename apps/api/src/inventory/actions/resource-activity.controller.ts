import type { ActionRun } from '@pulsegrid/shared';
import { Controller, Get, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ResourceActionsService } from './resource-actions.service';

@Controller('resource-activity')
export class ResourceActivityController {
  constructor(private readonly actions: ResourceActionsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query('account', ParseUUIDPipe) account: string,
  ): Promise<ActionRun[]> {
    return this.actions.activity(auth, account);
  }
}
