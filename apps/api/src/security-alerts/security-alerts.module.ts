import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { text } from 'express';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AwsSecurityWebhookController, WEBHOOK_PATH } from './aws-security-webhook.controller';
import { SecurityAlertsCoreModule } from './security-alerts-core.module';
import { SecurityAlertsController } from './security-alerts.controller';
import { CONFIRM_SUBSCRIPTION, SecurityAlertsInbox, visitSubscribeUrl } from './security-alerts.inbox';
import { SecurityAlertsService } from './security-alerts.service';
import { FETCH_CERTIFICATE, fetchCertificate, SigningCertificates } from './signing-certificates';
import { SlackController } from './slack.controller';
import { SnsVerifier } from './sns-verifier';

/** SNS sends JSON as text/plain, and a message can be up to 256 KB. */
const SNS_BODY = text({ type: 'text/plain', limit: '512kb' });

@Module({
  imports: [AuditModule, AuthModule, SecurityAlertsCoreModule],
  controllers: [AwsSecurityWebhookController, SecurityAlertsController, SlackController],
  providers: [
    { provide: FETCH_CERTIFICATE, useValue: fetchCertificate },
    { provide: CONFIRM_SUBSCRIPTION, useValue: visitSubscribeUrl },
    SecurityAlertsInbox,
    SecurityAlertsService,
    SigningCertificates,
    SnsVerifier,
  ],
})
export class SecurityAlertsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SNS_BODY).forRoutes({ path: WEBHOOK_PATH, method: RequestMethod.POST });
  }
}
