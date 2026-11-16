import { Inject, Injectable } from '@nestjs/common';
import { SECURITY_ALERTS_SETTINGS, type SecurityAlertsSettings } from './security-alerts.settings';
import { type SnsMessage, snsMessageSchema } from './sns-message';
import { hasValidSignature, isSigningCertUrl } from './sns-signature';
import { SigningCertificates } from './signing-certificates';

const MAX_AGE_MS = 60 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;

export type Verification = { verified: true; message: SnsMessage } | { verified: false; reason: string };

const parse = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
};

const ageProblem = (timestamp: string, now: number): string | null => {
  const sentAt = Date.parse(timestamp);
  if (Number.isNaN(sentAt)) {
    return 'the timestamp is not a date';
  }
  if (now - sentAt > MAX_AGE_MS) {
    return 'the message is more than an hour old';
  }
  return sentAt - now > CLOCK_SKEW_MS ? 'the message is dated in the future' : null;
};

/** Checks an SNS message before anything trusts it: its shape, topic, age and signature, cheapest first. */
@Injectable()
export class SnsVerifier {
  constructor(
    private readonly certificates: SigningCertificates,
    @Inject(SECURITY_ALERTS_SETTINGS) private readonly settings: SecurityAlertsSettings,
  ) {}

  async verify(body: string, now = Date.now()): Promise<Verification> {
    const parsed = snsMessageSchema.safeParse(parse(body));
    if (!parsed.success) {
      return { verified: false, reason: 'it is not an SNS message' };
    }
    const message = parsed.data;
    if (!this.settings.topicArns.has(message.TopicArn)) {
      return { verified: false, reason: `topic ${message.TopicArn} is not allowed` };
    }
    const tooOld = ageProblem(message.Timestamp, now);
    if (tooOld) {
      return { verified: false, reason: tooOld };
    }
    if (!isSigningCertUrl(message.SigningCertURL)) {
      return { verified: false, reason: 'the signing certificate is not on an SNS host' };
    }
    const certificate = await this.certificates.get(message.SigningCertURL).catch(() => null);
    if (!certificate) {
      return { verified: false, reason: 'the signing certificate could not be downloaded' };
    }
    return hasValidSignature(message, certificate)
      ? { verified: true, message }
      : { verified: false, reason: 'the signature does not match' };
  }
}
