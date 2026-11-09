import type { CostOverview } from '@pulsegrid/shared';
import { Controller, Get } from '@nestjs/common';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import { RequirePermission } from '../../auth/guards/require-permission.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { CostsService } from './costs.service';

@Controller('costs')
export class CostsController {
  constructor(private readonly costs: CostsService) {}

  @Get()
  @RequirePermission('costs.view')
  overview(@CurrentAuth() auth: AuthContext): Promise<CostOverview> {
    return this.costs.overview(auth);
  }
}
