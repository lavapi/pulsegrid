import type {
  ProductionRelease,
  ProductionReleaseDecisionResult,
  ProductionReleasesView,
} from '@pulsegrid/shared';
import { Body, Controller, Get, Header, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequirePermission } from '../auth/guards/require-permission.decorator';
import type { AuthContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ProductionReleasesService } from './production-releases.service';

const READ_LIMIT = { default: { limit: 120, ttl: 60_000 } };
const DECIDE_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const decideSchema = z.object({ decision: z.enum(['finish', 'rollback']) });

/** The production release waiting in its hold, its history, and finishing or rolling it back. */
@Controller('production-releases')
@RequirePermission('production.release.decide')
@UseGuards(ThrottlerGuard)
export class ProductionReleasesController {
  constructor(private readonly releases: ProductionReleasesService) {}

  @Get('current')
  @Header('Cache-Control', 'no-store')
  @Throttle(READ_LIMIT)
  current(@CurrentAuth() auth: AuthContext): Promise<ProductionReleasesView> {
    return this.releases.view(auth);
  }

  @Get('waiting')
  @Header('Cache-Control', 'no-store')
  @Throttle(READ_LIMIT)
  waiting(@CurrentAuth() auth: AuthContext): Promise<{ count: number }> {
    return this.releases.waiting(auth);
  }

  @Get('history')
  @Header('Cache-Control', 'no-store')
  @Throttle(READ_LIMIT)
  history(@CurrentAuth() auth: AuthContext): Promise<ProductionRelease[]> {
    return this.releases.history(auth);
  }

  @Post('decide')
  @Throttle(DECIDE_LIMIT)
  decide(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(decideSchema, 'Choose to finish or roll back the release.')) body: z.infer<typeof decideSchema>,
    @Req() request: Request,
  ): Promise<ProductionReleaseDecisionResult> {
    return this.releases.decide(auth, body.decision, request.ip);
  }
}
