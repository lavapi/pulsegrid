import type { Release } from '@pulsegrid/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../src/config/app-config';
import { DATABASE } from '../src/database/database.module';
import { TenantDatabase } from '../src/database/tenant-database';
import { NotificationSettings } from '../src/notifications/notification-settings';
import { NotificationsCheck } from '../src/notifications/notifications-check';
import { SentLog } from '../src/notifications/sent-log';
import { SLACK_CLIENTS, SlackApps } from '../src/notifications/slack-apps';
import { type SlackClient, SlackError } from '../src/notifications/slack-client';
import { GitConnectionsService } from '../src/pipelines/git/git-connections.service';
import {
  GIT_PROVIDER_LIST,
  type GitClient,
  type GitProvider,
  type GitPullRequest,
  type PullRequestChecks,
} from '../src/pipelines/git/git-provider';
import type { ReleasesService } from '../src/releases/releases.service';
import { signIn, startTestApp, type TestContext, user } from './support/test-app';

const GOOD_TOKEN = 'xoxb-test-token-slack-accepts';
const BAD_TOKEN = 'xoxb-test-token-slack-revoked';
const REPOSITORY = 'acme-org/api';

const slack = {
  people: new Map<string, { id: string; name: string }>(),
  sent: [] as { to: string; text: string }[],
  failSending: false,
};

const fakeSlack = (token: string): SlackClient =>
  ({
    workspace: async () => {
      if (token === BAD_TOKEN) throw new SlackError('This token was revoked in Slack.', 'token_revoked');
      return 'Acme Workspace';
    },
    userByEmail: async (email: string) => slack.people.get(email) ?? null,
    message: async (to: string, text: string) => {
      if (slack.failSending) throw new SlackError('Slack is busy right now.', 'ratelimited');
      slack.sent.push({ to, text });
    },
  }) as unknown as SlackClient;

const github = {
  users: new Set(['ada-dev', 'bo-dev']),
  pulls: [] as GitPullRequest[],
  checks: new Map<number, PullRequestChecks>(),
};

const gitClient = {
  checkAccess: async () => ({ account: 'acme-org', repositories: 1, canRun: true }),
  listOpenPullRequests: async () => github.pulls,
  pullRequestChecks: async (_repository: string, number: number) =>
    github.checks.get(number) ?? { outcome: 'none', failed: [], mergeable: 'unknown' },
  userExists: async (login: string) => github.users.has(login.toLowerCase()),
} as unknown as GitClient;

const gitProvider: GitProvider = {
  id: 'github',
  parseCredentials: (input) => input as Record<string, string>,
  credentialHint: () => '…oken',
  connect: () => gitClient,
};

const pull = (number: number, fields: Partial<GitPullRequest> = {}): GitPullRequest => ({
  repository: REPOSITORY,
  number,
  title: `Change ${number}`,
  author: 'ada-dev',
  headSha: `sha-${number}`,
  draft: false,
  url: `https://github.com/${REPOSITORY}/pull/${number}`,
  ...fields,
});

const READY: PullRequestChecks = { outcome: 'passed', failed: [], mergeable: 'clean' };
const FAILED: PullRequestChecks = { outcome: 'failed', failed: ['test'], mergeable: 'clean' };

const NOW = Date.parse('2026-11-26T12:00:00Z');
const releases: Release[] = [];
const deploy = (id: string, readyAt: string, actor = 'ada-dev'): Release => ({
  id,
  appId: 'app-1',
  appName: 'api',
  workflowId: '1',
  pipelineName: 'Deploy',
  serviceName: 'api-service',
  serviceDisplayName: null,
  servicePath: null,
  environmentName: 'staging',
  appDomains: [],
  run: {
    id: `run-${id}`,
    workflowId: '1',
    workflowName: 'Deploy',
    repository: REPOSITORY,
    number: 1,
    title: 'Ship it',
    branch: 'main',
    commit: 'abc1234',
    event: 'push',
    actor,
    status: 'success',
    startedAt: readyAt,
    finishedAt: readyAt,
    durationSeconds: 60,
    url: 'https://github.com/run',
  },
  state: 'ready',
  stages: [],
  readyAt,
  matchedBy: null,
  issue: null,
});

describe('notifications', () => {
  let context: TestContext;
  let admin: string;
  let developer: string;
  let viewer: string;
  let check: NotificationsCheck;
  const http = () => request(context.app.getHttpServer());
  const tenantId = () => context.acme.tenant.id;
  const saveMine = (cookie: string, fields: object) =>
    http()
      .put('/api/notifications/me')
      .set('Cookie', cookie)
      .send({ githubLogin: null, prReady: true, prFailed: true, deployReady: true, deployFailed: true, ...fields });
  const connectSlack = (botToken = GOOD_TOKEN) =>
    http().put('/api/integrations/slack').set('Cookie', admin).send({ botToken });

  beforeAll(async () => {
    context = await startTestApp((builder) =>
      builder.overrideProvider(GIT_PROVIDER_LIST).useValue([gitProvider]).overrideProvider(SLACK_CLIENTS).useValue(fakeSlack),
    );
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    developer = await signIn(context, context.acme, user('bo', 'developer'));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
    const { body } = await http()
      .post('/api/git/connections')
      .set('Cookie', admin)
      .send({ provider: 'github', name: 'Acme', organization: 'acme-org', credentials: { token: 'test-token' } })
      .expect(201);
    await context.owner
      .insertInto('pipeline_apps')
      .values({ tenant_id: tenantId(), name: 'api', repository: REPOSITORY, connection_id: body.id })
      .execute();
    const app = context.app;
    const fakeReleases = { everyRelease: async () => releases } as unknown as ReleasesService;
    check = new NotificationsCheck(
      app.get(DATABASE),
      app.get(TenantDatabase),
      app.get(SlackApps),
      app.get(NotificationSettings),
      app.get(SentLog),
      app.get(GitConnectionsService),
      fakeReleases,
      app.get(APP_CONFIG),
    );
  });
  afterAll(() => context.close());

  beforeEach(async () => {
    slack.people = new Map([
      ['ada@example.test', { id: 'U-ADA', name: 'Ada' }],
      ['bo@example.test', { id: 'U-BO', name: 'Bo' }],
    ]);
    slack.sent = [];
    slack.failSending = false;
    github.pulls = [];
    github.checks = new Map();
    releases.length = 0;
    await context.owner.deleteFrom('notifications_sent').execute();
    await context.owner.deleteFrom('notification_settings').execute();
    await context.owner.deleteFrom('slack_apps').execute();
  });

  describe('Slack app', () => {
    it('is only for people who manage integrations', async () => {
      await http().get('/api/integrations/slack').set('Cookie', viewer).expect(403);
      await http().put('/api/integrations/slack').set('Cookie', developer).send({ botToken: GOOD_TOKEN }).expect(403);
    });

    it('connects with a token Slack accepts, never showing it, and audits it', async () => {
      const { body } = await connectSlack().expect(200);
      expect(body).toMatchObject({ connected: true, workspace: 'Acme Workspace', updatedBy: 'ada@example.test' });
      expect(JSON.stringify(body)).not.toContain(GOOD_TOKEN);
      const row = await context.owner.selectFrom('slack_apps').select('encrypted_token').executeTakeFirstOrThrow();
      expect(row.encrypted_token).not.toContain(GOOD_TOKEN);
      const events = await context.owner
        .selectFrom('audit_events')
        .select('action')
        .where('action', '=', 'integration.slack.connected')
        .execute();
      expect(events.length).toBeGreaterThan(0);
    });

    it('refuses a token Slack rejects, or one that is not a bot token, with a readable message', async () => {
      expect((await connectSlack(BAD_TOKEN).expect(400)).body.message).toBe('This token was revoked in Slack.');
      expect((await connectSlack('xoxp-test-token-not-a-bot-one').expect(400)).body.message).toBe(
        'Paste the Bot User OAuth Token. It starts with xoxb-.',
      );
      expect((await http().get('/api/integrations/slack').set('Cookie', admin).expect(200)).body.connected).toBe(false);
    });

    it('disconnects', async () => {
      await connectSlack().expect(200);
      await http().delete('/api/integrations/slack').set('Cookie', admin).expect(204);
      expect((await http().get('/api/integrations/slack').set('Cookie', admin).expect(200)).body.connected).toBe(false);
    });

    it('keeps each project to its own app', async () => {
      await connectSlack().expect(200);
      const other = await signIn(context, context.globex, user('gia', 'admin'));
      expect((await http().get('/api/integrations/slack').set('Cookie', other).expect(200)).body.connected).toBe(false);
    });
  });

  describe('my notifications', () => {
    it('starts with everything on and says Slack is not connected', async () => {
      const { body } = await http().get('/api/notifications/me').set('Cookie', viewer).expect(200);
      expect(body).toEqual({
        githubLogin: null,
        prReady: true,
        prFailed: true,
        deployReady: true,
        deployFailed: true,
        slack: { status: 'not-connected' },
      });
    });

    it('saves a GitHub username and switches, and shows the Slack name', async () => {
      await connectSlack().expect(200);
      const { body } = await saveMine(developer, { githubLogin: 'bo-dev', deployReady: false }).expect(200);
      expect(body).toMatchObject({ githubLogin: 'bo-dev', deployReady: false, slack: { status: 'found', name: 'Bo' } });
    });

    it('says when Slack has no one with the sign-in email', async () => {
      await connectSlack().expect(200);
      slack.people.delete('bo@example.test');
      expect((await http().get('/api/notifications/me').set('Cookie', developer).expect(200)).body.slack).toEqual({
        status: 'not-found',
      });
    });

    it('refuses usernames GitHub lacks, malformed ones, and ones someone else took', async () => {
      expect((await saveMine(developer, { githubLogin: 'nobody-here' }).expect(400)).body.message).toBe(
        "There's no one on GitHub with that username.",
      );
      await saveMine(developer, { githubLogin: '-bad name' }).expect(400);
      await saveMine(admin, { githubLogin: 'bo-dev' }).expect(200);
      expect((await saveMine(developer, { githubLogin: 'BO-DEV' }).expect(409)).body.message).toBe(
        'Someone in this project already uses that GitHub username.',
      );
    });

    it('sends the person a test message', async () => {
      await connectSlack().expect(200);
      await http().post('/api/notifications/me/test').set('Cookie', viewer).expect(400);
      await http().post('/api/notifications/me/test').set('Cookie', developer).expect(204);
      expect(slack.sent).toEqual([{ to: 'U-BO', text: expect.stringContaining('can reach you') }]);
    });
  });

  describe('the check', () => {
    beforeEach(async () => {
      await connectSlack().expect(200);
      await saveMine(admin, { githubLogin: 'ada-dev' }).expect(200);
    });

    it('messages the author once when their pull request is ready to merge', async () => {
      github.pulls = [pull(1)];
      github.checks.set(1, READY);
      await check.runFor(tenantId(), NOW);
      await check.runFor(tenantId(), NOW);
      expect(slack.sent).toEqual([{ to: 'U-ADA', text: expect.stringContaining("ready to merge") }]);
    });

    it('messages again after a new push is ready', async () => {
      github.pulls = [pull(1)];
      github.checks.set(1, READY);
      await check.runFor(tenantId(), NOW);
      github.pulls = [pull(1, { headSha: 'sha-new' })];
      await check.runFor(tenantId(), NOW);
      expect(slack.sent).toHaveLength(2);
    });

    it('says which checks failed', async () => {
      github.pulls = [pull(2)];
      github.checks.set(2, FAILED);
      await check.runFor(tenantId(), NOW);
      expect(slack.sent[0]?.text).toContain('test failed');
    });

    it('skips drafts, running checks, and authors without a username here', async () => {
      github.pulls = [pull(1, { draft: true }), pull(2), pull(3, { author: 'stranger' })];
      github.checks.set(1, READY);
      github.checks.set(2, { outcome: 'pending', failed: [], mergeable: 'clean' });
      github.checks.set(3, READY);
      await check.runFor(tenantId(), NOW);
      expect(slack.sent).toEqual([]);
    });

    it('respects a switch turned off', async () => {
      await saveMine(admin, { githubLogin: 'ada-dev', prReady: false }).expect(200);
      github.pulls = [pull(1)];
      github.checks.set(1, READY);
      await check.runFor(tenantId(), NOW);
      expect(slack.sent).toEqual([]);
    });

    it('tries again later when Slack fails or cannot find the person', async () => {
      github.pulls = [pull(1)];
      github.checks.set(1, READY);
      slack.failSending = true;
      await check.runFor(tenantId(), NOW);
      slack.failSending = false;
      slack.people.delete('ada@example.test');
      await check.runFor(tenantId(), NOW);
      expect(slack.sent).toEqual([]);
      slack.people.set('ada@example.test', { id: 'U-ADA', name: 'Ada' });
      await check.runFor(tenantId(), NOW);
      expect(slack.sent).toHaveLength(1);
    });

    it('messages the person who started a deploy that just finished, not old ones', async () => {
      releases.push(deploy('r1', '2026-11-26T11:50:00Z'), deploy('r2', '2026-11-26T08:00:00Z'), deploy('r3', '2026-11-26T11:55:00Z', 'stranger'));
      await check.runFor(tenantId(), NOW);
      await check.runFor(tenantId(), NOW);
      expect(slack.sent).toEqual([{ to: 'U-ADA', text: expect.stringContaining('🚀 *api* is ready on *staging*') }]);
      expect(slack.sent[0]?.text).toContain('<http://localhost:3000/releases|Open releases>');
    });

    it('sends nothing without a Slack app', async () => {
      await http().delete('/api/integrations/slack').set('Cookie', admin).expect(204);
      github.pulls = [pull(1)];
      github.checks.set(1, READY);
      await check.run(NOW);
      expect(slack.sent).toEqual([]);
    });
  });
});
