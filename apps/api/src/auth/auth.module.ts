import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from '../audit/audit.module';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { TokenCipher } from '../inventory/connection/token-cipher';
import { TenantsModule } from '../tenants/tenants.module';
import { AccountStore } from './account-store';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GOOGLE_OAUTH, GoogleOAuthClient } from './google/google-oauth';
import { GoogleSignInService } from './google/google-sign-in.service';
import { PermissionGuard } from './guards/permission.guard';
import { SessionGuard } from './guards/session.guard';
import { LEAKED_PASSWORDS, PwnedPasswords } from './passwords/leaked-passwords';
import { SessionService } from './session/session.service';
import { SetupService } from './setup.service';

@Global()
@Module({
  imports: [
    AuditModule,
    TenantsModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
  ],
  controllers: [AccountController, AuthController],
  providers: [
    AccountService,
    AccountStore,
    AuthService,
    GoogleSignInService,
    SessionService,
    SetupService,
    {
      provide: TokenCipher,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new TokenCipher(config.tokenEncryptionKey),
    },
    {
      provide: GOOGLE_OAUTH,
      inject: [APP_CONFIG],
      useFactory: ({ google }: AppConfig) =>
        google ? new GoogleOAuthClient(google.clientId, google.clientSecret) : null,
    },
    { provide: LEAKED_PASSWORDS, useClass: PwnedPasswords },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AccountStore, AuthService, SessionService],
})
export class AuthModule {}
