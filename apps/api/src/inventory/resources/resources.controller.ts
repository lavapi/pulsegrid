import {
  type InfrastructureMap,
  isResourceType,
  isServiceCategory,
  RESOURCE_HEALTH,
  type Resource,
  type ResourcePage,
  type ResourceTypeCount,
  type ServiceCategorySummary,
} from '@pulsegrid/shared';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
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
  constructor(private readonly resources: ResourcesService) {}

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
}
