import type { Person, TemporaryPassword } from '@pulsegrid/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequireOwner } from '../auth/guards/require-owner.decorator';
import { emailSchema, nameSchema } from '../auth/requests';
import type { AuthContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PeopleService } from './people.service';

const personSchema = z.object({ firstName: nameSchema, lastName: nameSchema, email: emailSchema });
const INVALID_PERSON = 'Enter a first name, last name and valid email.';

@Controller('people')
@RequireOwner()
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get()
  list(): Promise<Person[]> {
    return this.people.list();
  }

  @Post()
  @UseGuards(ThrottlerGuard)
  async add(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(personSchema, INVALID_PERSON)) body: z.infer<typeof personSchema>,
    @Req() request: Request,
  ): Promise<TemporaryPassword> {
    return (await this.people.add(auth, body, request.ip)).temporaryPassword;
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.people.remove(auth, id, request.ip);
  }

  @Post(':id/super-admin')
  @HttpCode(204)
  makeSuperAdmin(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.people.makeSuperAdmin(auth, id, request.ip);
  }
}
