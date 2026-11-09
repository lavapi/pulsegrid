import type { SecretView } from '@pulsegrid/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { SecretsService } from './secrets.service';

const READ_LIMIT = { default: { limit: 30, ttl: 60_000 } };
const WRITE_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const INVALID_REQUEST = 'That secret request is not valid.';
const NO_STORE = 'no-store';
const MAX_VALUE_LENGTH = 65_536;

const key = z.string().min(1).max(256).regex(/^[^\p{Cc}]+$/u);
const versionId = z.string().min(1).max(64);

const revealSchema = z.object({ key: key.nullable() });
const saveSchema = z.object({
  key: key.nullable(),
  name: key.nullable(),
  value: z.string().max(MAX_VALUE_LENGTH),
  versionId,
});
const removeSchema = z.object({ key, versionId });

@Controller('resources/:id/secret')
export class SecretsController {
  constructor(private readonly secrets: SecretsService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  view(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SecretView> {
    return this.secrets.view(auth, id);
  }

  @Post('reveal')
  @HttpCode(200)
  @Header('Cache-Control', NO_STORE)
  @UseGuards(ThrottlerGuard)
  @Throttle(READ_LIMIT)
  reveal(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(revealSchema, INVALID_REQUEST)) body: z.infer<typeof revealSchema>,
    @Req() request: Request,
  ): Promise<{ value: string }> {
    return this.secrets.reveal(auth, id, body, request.ip);
  }

  @Put('keys')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  save(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(saveSchema, INVALID_REQUEST)) body: z.infer<typeof saveSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.secrets.save(auth, id, body, request.ip);
  }

  @Post('keys/delete')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle(WRITE_LIMIT)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(removeSchema, INVALID_REQUEST)) body: z.infer<typeof removeSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.secrets.remove(auth, id, body, request.ip);
  }
}
