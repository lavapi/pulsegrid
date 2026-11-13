import {
  type InfrastructureMap,
  isResourceType,
  isServiceCategory,
  DISPLAY_NAME_MAX_LENGTH,
  RESOURCE_HEALTH,
  type Resource,
  type ResourcePage,
  type ResourceTypeCount,
  type ServiceCategorySummary,
} from '@pulsegrid/shared';
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import { RequirePermission } from '../../auth/guards/require-permission.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { DisplayNamesService } from './display-names.service';
import { decodeResourceCursor, type ResourceCursor } from './resource-cursor';
import { ResourcesService } from './resources.service';

const filterSchema = z.object({
  type: z.string().refine(isResourceType).optional(),
  category: z.string().refine(isServiceCategory).optional(),
  account: z.string().uuid().optional(),
  environment: z.string().uuid().optional(),
  region: z.string().max(40).optional(),
  q: z.string().trim().max(200).optional(),
  health: z.enum(RESOURCE_HEALTH).optional(),
});

const displayNameSchema = z.object({ displayName: z.string().max(DISPLAY_NAME_MAX_LENGTH * 2) });

const pageSchema = filterSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .max(1000)
    .transform((value, context): ResourceCursor => {
      const cursor = decodeResourceCursor(value);
      if (!cursor) {
        context.addIssue({ code: z.ZodIssueCode.custom });
        return z.NEVER;
      }
      return cursor;
    })
    .optional(),
});

const mapSchema = z.object({
  account: z.string().uuid(),
  region: z.string().max(40).optional(),
});

const INVALID_FILTER = 'Those filters are not valid.';

const toFilter = (query: z.infer<typeof filterSchema>) => ({
  type: query.type,
  category: query.category,
  cloudAccountId: query.account,
  environmentId: query.environment,
  region: query.region,
  search: query.q,
  health: query.health,
});

@Controller('resources')
export class ResourcesController {
  constructor(
    private readonly resources: ResourcesService,
    private readonly displayNames: DisplayNamesService,
  ) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(pageSchema, INVALID_FILTER)) query: z.infer<typeof pageSchema>,
  ): Promise<ResourcePage> {
    return this.resources.list(auth, {
      ...toFilter(query),
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(filterSchema, INVALID_FILTER)) query: z.infer<typeof filterSchema>,
  ): Promise<ResourceTypeCount[]> {
    return this.resources.summary(auth, toFilter(query));
  }

  @Get('categories')
  categories(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(filterSchema, INVALID_FILTER)) query: z.infer<typeof filterSchema>,
  ): Promise<ServiceCategorySummary[]> {
    return this.resources.categories(auth, toFilter(query));
  }

  @Get('map')
  map(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(mapSchema, INVALID_FILTER)) query: z.infer<typeof mapSchema>,
  ): Promise<InfrastructureMap> {
    return this.resources.map(auth, query.account, query.region);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Resource> {
    return this.resources.get(auth, id);
  }

  /** Gives the resource a display name in PulseGrid, or removes it with an empty one. Nothing changes in the cloud. */
  @Put(':id/display-name')
  @RequirePermission('environments.manage')
  rename(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(displayNameSchema, 'Enter a display name.'))
    { displayName }: z.infer<typeof displayNameSchema>,
    @Req() request: Request,
  ): Promise<Resource> {
    return this.displayNames.rename(auth, id, displayName, request.ip);
  }
}
