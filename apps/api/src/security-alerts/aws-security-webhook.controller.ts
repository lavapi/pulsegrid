import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Logger,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../auth/guards/public.decorator';
import { SecurityAlertsInbox } from './security-alerts.inbox';
import { SnsVerifier } from './sns-verifier';

export const WEBHOOK_PATH = 'webhooks/aws-security';

const NOT_VERIFIED = "This message couldn't be verified.";
const NOT_SET_UP = 'Security alerts are not set up yet.';
const NOT_AN_ALERT = "This message isn't a security alert PulseGrid can read.";

/** Where AWS pushes security alerts through SNS. Nothing is trusted until the message is verified. */
@Controller(WEBHOOK_PATH)
export class AwsSecurityWebhookController {
  private readonly logger = new Logger(AwsSecurityWebhookController.name);

  constructor(
    private readonly verifier: SnsVerifier,
    private readonly inbox: SecurityAlertsInbox,
  ) {}

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Body() body: unknown): Promise<{ received: true }> {
    const verification =
      typeof body === 'string' ? await this.verifier.verify(body) : { verified: false as const, reason: 'the body is not text' };
    if (!verification.verified) {
      this.logger.warn(`Refused an SNS message: ${verification.reason}`);
      throw new ForbiddenException(NOT_VERIFIED);
    }
    const result = await this.inbox.receive(verification.message);
    if (result === 'not-set-up') {
      throw new ServiceUnavailableException(NOT_SET_UP);
    }
    if (result === 'rejected') {
      throw new BadRequestException(NOT_AN_ALERT);
    }
    return { received: true };
  }
}
