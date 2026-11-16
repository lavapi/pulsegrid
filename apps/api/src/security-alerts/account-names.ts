import { Inject, Injectable } from '@nestjs/common';
import { SECURITY_ALERTS_SETTINGS, type SecurityAlertsSettings } from './security-alerts.settings';

/** Names for the organization's AWS accounts, from the settings, so renaming one updates every alert. */
@Injectable()
export class AccountNames {
  constructor(@Inject(SECURITY_ALERTS_SETTINGS) private readonly settings: SecurityAlertsSettings) {}

  of(accountId: string): string | null {
    return this.settings.accountNames.get(accountId) ?? null;
  }

  label(accountId: string): string {
    const name = this.of(accountId);
    return name ? `${name} (${accountId})` : accountId;
  }
}
