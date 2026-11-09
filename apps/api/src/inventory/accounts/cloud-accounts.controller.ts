import {
  type AccountTagSummary,
  type CloudAccount,
  type CredentialCheck,
  EMPTY_TAG_FILTER,
} from '@pulsegrid/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import { RequirePermission } from '../../auth/guards/require-permission.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { CloudAccountsService } from './cloud-accounts.service';

const MAX_REGIONS = 30;
const MAX_TAG_RULES = 50;
const credentials = z.record(z.string().max(200), z.string().max(4000));

const replaceSchema = z.object({ credentials });
const checkSchema = replaceSchema.extend({ provider: z.string().max(40) });
const tagRules = z
  .array(
    z.object({
      key: z.string().trim().min(1).max(128),
      value: z.string().trim().max(256).nullable(),
    }),
  )
  .max(MAX_TAG_RULES);
const tagFilter = z.object({ include: tagRules, exclude: tagRules, keepUntagged: z.boolean() });
const settingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  regions: z
    .array(z.string().trim().max(40))
    .min(1)
    .max(MAX_REGIONS)
    .transform((regions) => [...new Set(regions)]),
  tagFilter: tagFilter.default(EMPTY_TAG_FILTER),
});
const accountSchema = checkSchema.merge(settingsSchema).extend({
  environmentId: z.string().uuid().nullable(),
});

const INVALID_ACCOUNT = 'Enter a name, at least one region and your credentials.';

@Controller('cloud/accounts')
export class CloudAccountsController {
  constructor(private readonly accounts: CloudAccountsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<CloudAccount[]> {
    return this.accounts.list(auth.tenantId);
  }

  @Post('check')
  @RequirePermission('integrations.manage')
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  check(
    @Body(new ZodPipe(checkSchema, INVALID_ACCOUNT)) body: z.infer<typeof checkSchema>,
  ): Promise<CredentialCheck> {
    return this.accounts.checkCredentials(body.provider, body.credentials);
  }

  @Post()
  @RequirePermission('integrations.manage')
  @UseGuards(ThrottlerGuard)
  add(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(accountSchema, INVALID_ACCOUNT)) body: z.infer<typeof accountSchema>,
    @Req() request: Request,
  ): Promise<CloudAccount> {
    return this.accounts.add(auth, body, request.ip);
  }

  @Put(':id/credentials')
  @RequirePermission('integrations.manage')
  @UseGuards(ThrottlerGuard)
  replaceCredentials(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(replaceSchema, INVALID_ACCOUNT)) body: z.infer<typeof replaceSchema>,
    @Req() request: Request,
  ): Promise<CloudAccount> {
    return this.accounts.replaceCredentials(auth, id, body.credentials, request.ip);
  }

  @Get(':id/tags')
  @RequirePermission('integrations.manage')
  tags(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountTagSummary> {
    return this.accounts.tagSummary(auth, id);
  }

  @Put(':id')
  @RequirePermission('integrations.manage')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(settingsSchema, INVALID_ACCOUNT)) body: z.infer<typeof settingsSchema>,
    @Req() request: Request,
  ): Promise<CloudAccount> {
    return this.accounts.update(auth, id, body, request.ip);
  }

  @Delete(':id')
  @RequirePermission('integrations.manage')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.accounts.remove(auth, id, request.ip);
  }

  @Post(':id/test')
  @RequirePermission('integrations.manage')
  @HttpCode(200)
  test(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CloudAccount> {
    return this.accounts.testConnection(auth, id);
  }

  @Post(':id/sync')
  @RequirePermission('accounts.sync')
  @HttpCode(202)
  sync(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.accounts.requestSync(auth, id, request.ip);
  }
}
