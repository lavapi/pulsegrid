import type { ServiceDeploymentsView } from '@pulsegrid/shared';
import { Controller, Get, Header, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ServiceDeploymentsService } from './service-deployments.service';

const READ_LIMIT = { default: { limit: 60, ttl: 60_000 } };

@Controller('resources/:id/deployments')
export class ServiceDeploymentsController {
  constructor(private readonly deployments: ServiceDeploymentsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle(READ_LIMIT)
  recent(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<ServiceDeploymentsView> {
    return this.deployments.recent(auth, id);
  }
}
