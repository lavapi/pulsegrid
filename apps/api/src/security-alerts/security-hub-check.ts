import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantDatabase } from '../database/tenant-database';
import { type NormalizedAlert, normalizeFinding } from './alert-normalizer';
import { ReceivingProject } from './receiving-project';
import { SecurityAlertsIntake } from './security-alerts.intake';
import { SECURITY_ALERTS_SETTINGS, type SecurityAlertsSettings } from './security-alerts.settings';
import { SecurityAlertsStore } from './security-alerts.store';
import { SecurityHubReader } from './security-hub-reader';

/** Looks back three runs, and at least 30 minutes, so a slow or missed run loses nothing. */
const lookBackMs = (everyMinutes: number): number => Math.max(3 * everyMinutes, 30) * 60_000;

const normalizeAll = (findings: readonly unknown[], receivedAt: Date): NormalizedAlert[] =>
  findings.flatMap((finding) => {
    const alert = normalizeFinding(finding, receivedAt);
    return alert ? [alert] : [];
  });

export interface CheckResult {
  created: number;
  updated: number;
  refreshed: number;
}

/**
 * Every few minutes, asks Security Hub for what push may have missed: new or changed GuardDuty findings and failed
 * critical checks, and the current state of every alert still open, such as a check that now passes.
 */
@Injectable()
export class SecurityHubCheck {
  private readonly logger = new Logger(SecurityHubCheck.name);

  constructor(
    private readonly reader: SecurityHubReader,
    private readonly database: TenantDatabase,
    private readonly store: SecurityAlertsStore,
    private readonly intake: SecurityAlertsIntake,
    private readonly project: ReceivingProject,
    @Inject(SECURITY_ALERTS_SETTINGS) private readonly settings: SecurityAlertsSettings,
  ) {}

  async run(now = new Date()): Promise<CheckResult | null> {
    const check = this.settings.check;
    const tenantId = check ? await this.project.id() : null;
    if (!check || !tenantId) {
      return null;
    }
    const openKeys = await this.database.run(tenantId, (trx) => this.store.openFindingKeys(trx));
    const [changed, open] = await Promise.all([
      this.reader.updatedSince(new Date(now.getTime() - lookBackMs(check.everyMinutes))),
      this.reader.byIds(openKeys),
    ]);
    const result = await this.database.run(tenantId, async (trx) => {
      const saved = await this.intake.save(trx, tenantId, normalizeAll(changed, now));
      const refreshed = await this.intake.refresh(trx, normalizeAll(open, now));
      return { ...saved, refreshed };
    });
    this.logger.log(
      `Security Hub check: ${changed.length} changed finding(s), ${result.created} new; ` +
        `${open.length} of ${openKeys.length} open alert(s) found, ${result.refreshed} updated`,
    );
    return result;
  }
}
