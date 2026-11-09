import {
  DOMAIN_KINDS,
  type EnvironmentDomain,
  MAX_DOMAIN_LABEL_LENGTH,
  MAX_DOMAIN_URL_LENGTH,
} from '@pulsegrid/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import { RequirePermission } from '../../auth/guards/require-permission.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { EnvironmentDomainsService } from './environment-domains.service';

const domainSchema = z.object({
  kind: z.enum(DOMAIN_KINDS),
  label: z
    .string()
    .trim()
    .max(MAX_DOMAIN_LABEL_LENGTH)
    .nullish()
    .transform((value) => value || null),
  url: z.string().max(MAX_DOMAIN_URL_LENGTH),
});

const INVALID_DOMAIN = `Choose a type, enter a web address, and keep the name under ${MAX_DOMAIN_LABEL_LENGTH + 1} characters.`;

const domainBody = new ZodPipe(domainSchema, INVALID_DOMAIN);

@Controller('environments')
export class EnvironmentDomainsController {
  constructor(private readonly domains: EnvironmentDomainsService) {}

  @Get(':id/domains')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EnvironmentDomain[]> {
    return this.domains.list(auth.tenantId, id);
  }

  @Post(':id/domains')
  @RequirePermission('environments.manage')
  add(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(domainBody) body: z.infer<typeof domainSchema>,
    @Req() request: Request,
  ): Promise<EnvironmentDomain> {
    return this.domains.add(auth, id, body, request.ip);
  }

  @Put('domains/:domainId')
  @RequirePermission('environments.manage')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Body(domainBody) body: z.infer<typeof domainSchema>,
    @Req() request: Request,
  ): Promise<EnvironmentDomain> {
    return this.domains.update(auth, domainId, body, request.ip);
  }

  @Delete('domains/:domainId')
  @RequirePermission('environments.manage')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.domains.remove(auth, domainId, request.ip);
  }
}
