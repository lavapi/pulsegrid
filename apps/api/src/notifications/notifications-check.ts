import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database';
import { GitConnectionsService } from '../pipelines/git/git-connections.service';
import { ReleasesService } from '../releases/releases.service';
import { deployNotice, type Notice, pullRequestEvent, pullRequestNotice } from './messages';
import { NotificationSettings, type Watcher } from './notification-settings';
import { SentLog } from './sent-log';
import { SlackApps } from './slack-apps';
import type { SlackClient } from './slack-client';

const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'unknown error');

/**
 * Once a minute, per project with a Slack app: pull requests by people with a GitHub username whose checks are
 * ready or failed, and deploys those people started that finished, each sent once as a personal message.
 */
@Injectable()
export class NotificationsCheck {
  private readonly logger = new Logger(NotificationsCheck.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    private readonly slackApps: SlackApps,
    private readonly settings: NotificationSettings,
    private readonly sent: SentLog,
    private readonly git: GitConnectionsService,
    private readonly releases: ReleasesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async run(now = Date.now()): Promise<void> {
    const tenants = await this.db.selectFrom('tenants').select('id').execute();
    for (const { id } of tenants) {
      await this.runFor(id, now).catch((error: unknown) =>
        this.logger.warn(`Notification check failed for a project: ${errorName(error)}`),
      );
    }
  }

  async runFor(tenantId: string, now = Date.now()): Promise<void> {
    const { slack, watchers } = await this.database.run(tenantId, async (trx) => {
      await this.sent.forgetOld(trx);
      return { slack: await this.slackApps.client(trx, tenantId), watchers: await this.settings.watchers(trx) };
    });
    if (!slack || watchers.size === 0) {
      return;
    }
    const notices = [...(await this.pullRequestNotices(tenantId, watchers)), ...(await this.deployNotices(tenantId, now))];
    const wanted = notices.filter(({ githubLogin, kind }) => watchers.get(githubLogin.toLowerCase())?.[kind]);
    const unsent = await this.database.run(tenantId, (trx) => this.sent.unsent(trx, wanted.map(({ key }) => key)));
    await this.send(tenantId, slack, watchers, wanted.filter(({ key }) => unsent.has(key)));
  }

  private async pullRequestNotices(tenantId: string, watchers: ReadonlyMap<string, Watcher>): Promise<Notice[]> {
    const repositories = await this.database.run(tenantId, (trx) =>
      trx
        .selectFrom('pipeline_apps')
        .select(['repository', 'connection_id'])
        .where('connection_id', 'is not', null)
        .distinct()
        .execute(),
    );
    const notices: Notice[] = [];
    for (const { repository, connection_id: connectionId } of repositories) {
      try {
        const client = connectionId ? await this.git.clientFor(tenantId, connectionId) : null;
        if (!client) continue;
        const pulls = await client.listOpenPullRequests(repository);
        for (const pull of pulls.filter(({ draft, author }) => !draft && watchers.has(author.toLowerCase()))) {
          const checks = await client.pullRequestChecks(repository, pull.number, pull.headSha);
          const event = pullRequestEvent(checks);
          if (event) notices.push(pullRequestNotice(pull, checks, event));
        }
      } catch (error) {
        this.logger.warn(`Reading pull requests of ${repository} failed: ${errorName(error)}`);
      }
    }
    return notices;
  }

  private async deployNotices(tenantId: string, now: number): Promise<Notice[]> {
    const releasesUrl = new URL('/releases', this.config.publicUrl).toString();
    try {
      const releases = await this.releases.everyRelease(tenantId);
      return releases.flatMap((release) => deployNotice(release, releasesUrl, now) ?? []);
    } catch (error) {
      this.logger.warn(`Reading releases failed: ${errorName(error)}`);
      return [];
    }
  }

  /** Sends each notice to its person, recording it only once Slack took it, so a failure is tried next minute. */
  private async send(
    tenantId: string,
    slack: SlackClient,
    watchers: ReadonlyMap<string, Watcher>,
    notices: readonly Notice[],
  ): Promise<void> {
    const slackIds = new Map<string, string | null>();
    for (const notice of notices) {
      const watcher = watchers.get(notice.githubLogin.toLowerCase());
      if (!watcher) continue;
      try {
        if (!slackIds.has(watcher.email)) {
          slackIds.set(watcher.email, (await slack.userByEmail(watcher.email))?.id ?? null);
        }
        const slackId = slackIds.get(watcher.email);
        if (!slackId) continue;
        await slack.message(slackId, notice.text);
        await this.database.run(tenantId, (trx) => this.sent.markSent(trx, tenantId, notice.key));
        this.logger.log(`Sent ${notice.kind} to ${watcher.githubLogin}: ${notice.key}`);
      } catch (error) {
        this.logger.warn(`Sending ${notice.kind} failed: ${errorName(error)}`);
      }
    }
  }
}
