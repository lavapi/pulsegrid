import type { MyNotifications, MyNotificationsInput, SlackApp, SlackReach } from '@pulsegrid/shared';
import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/session/auth-context';
import { isUniqueViolation } from '../database/errors';
import { TenantDatabase } from '../database/tenant-database';
import { GitConnectionsService } from '../pipelines/git/git-connections.service';
import { NotificationSettings } from './notification-settings';
import { SlackApps } from './slack-apps';
import { SlackError } from './slack-client';

const NOT_CONNECTED = 'Connect Slack under Integrations first.';
const NOT_IN_SLACK = "No one in Slack uses your PulseGrid email address, so Slack can't reach you.";
const UNKNOWN_LOGIN = "There's no one on GitHub with that username.";
const LOGIN_TAKEN = 'Someone in this project already uses that GitHub username.';
const TEST_MESSAGE = "👋 PulseGrid can reach you here. You'll get a message when your pull requests or deploys are ready.";

/** Connecting the project's Slack app, and each person's own notification settings. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly database: TenantDatabase,
    private readonly slackApps: SlackApps,
    private readonly settings: NotificationSettings,
    private readonly git: GitConnectionsService,
    private readonly audit: AuditService,
  ) {}

  slackApp(auth: AuthContext): Promise<SlackApp> {
    return this.database.run(auth.tenantId, (trx) => this.slackApps.view(trx));
  }

  connectSlack(auth: AuthContext, token: string, ipAddress: string | undefined): Promise<SlackApp> {
    return this.database.run(auth.tenantId, async (trx) => {
      await this.slackApps.connect(trx, auth.tenantId, token, auth.email).catch((error: unknown) => {
        throw error instanceof SlackError ? new BadRequestException(error.message) : error;
      });
      await this.record(auth, 'integration.slack.connected', ipAddress, trx);
      return this.slackApps.view(trx);
    });
  }

  disconnectSlack(auth: AuthContext, ipAddress: string | undefined): Promise<void> {
    return this.database.run(auth.tenantId, async (trx) => {
      if (await this.slackApps.remove(trx)) {
        await this.record(auth, 'integration.slack.disconnected', ipAddress, trx);
      }
    });
  }

  /** A message to the person asking, so they see what notifications will look like. */
  async testSlack(auth: AuthContext): Promise<void> {
    const slack = await this.database.run(auth.tenantId, (trx) => this.slackApps.client(trx, auth.tenantId));
    if (!slack) {
      throw new NotFoundException(NOT_CONNECTED);
    }
    try {
      const user = await slack.userByEmail(auth.email);
      if (!user) {
        throw new BadRequestException(NOT_IN_SLACK);
      }
      await slack.message(user.id, TEST_MESSAGE);
    } catch (error) {
      if (error instanceof SlackError) {
        this.logger.warn(`Slack test message failed: ${error.code}`);
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }

  async mine(auth: AuthContext): Promise<MyNotifications> {
    const { settings, slack } = await this.database.run(auth.tenantId, async (trx) => ({
      settings: await this.settings.mine(trx, auth.userId),
      slack: await this.slackApps.client(trx, auth.tenantId),
    }));
    return { ...settings, slack: await this.reach(slack, auth.email) };
  }

  async saveMine(auth: AuthContext, input: MyNotificationsInput): Promise<MyNotifications> {
    if (input.githubLogin && !(await this.onGitHub(auth.tenantId, input.githubLogin))) {
      throw new BadRequestException(UNKNOWN_LOGIN);
    }
    try {
      await this.database.run(auth.tenantId, (trx) => this.settings.save(trx, auth.tenantId, auth.userId, input));
    } catch (error) {
      throw isUniqueViolation(error) ? new ConflictException(LOGIN_TAKEN) : error;
    }
    return this.mine(auth);
  }

  private async reach(slack: Awaited<ReturnType<SlackApps['client']>>, email: string): Promise<SlackReach> {
    if (!slack) {
      return { status: 'not-connected' };
    }
    try {
      const user = await slack.userByEmail(email);
      return user ? { status: 'found', name: user.name } : { status: 'not-found' };
    } catch {
      return { status: 'unknown' };
    }
  }

  /** Whether GitHub knows the username, asked through the project's first Git connection; without one, trusted. */
  private async onGitHub(tenantId: string, login: string): Promise<boolean> {
    const [connection] = await this.git.list(tenantId);
    const client = connection ? await this.git.clientFor(tenantId, connection.id) : null;
    return client ? client.userExists(login).catch(() => true) : true;
  }

  private record(
    auth: AuthContext,
    action: string,
    ipAddress: string | undefined,
    trx: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    return this.audit.record(trx, {
      tenantId: auth.tenantId,
      action,
      actor: { userId: auth.userId, email: auth.email },
      target: { type: 'integration', id: 'slack' },
      ipAddress,
    });
  }
}
