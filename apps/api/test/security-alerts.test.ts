import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from '../src/config/app-config';
import { TenantDatabase } from '../src/database/tenant-database';
import { AccountNames } from '../src/security-alerts/account-names';
import {
  fixtureEvent,
  notification,
  sign,
  SUBSCRIBE_URL,
  subscriptionConfirmation,
  TEST_CERTIFICATE,
} from '../src/security-alerts/fixtures/sns-fixtures';
import { CONFIRM_SUBSCRIPTION } from '../src/security-alerts/security-alerts.inbox';
import { SecurityAlertsNotifier } from '../src/security-alerts/security-alerts.notifier';
import { SecurityAlertsQueue } from '../src/security-alerts/security-alerts.queue';
import { SecurityAlertsStore } from '../src/security-alerts/security-alerts.store';
import { FETCH_CERTIFICATE } from '../src/security-alerts/signing-certificates';
import { SlackIntegrations } from '../src/security-alerts/slack-integrations';
import { POST_TO_SLACK, SlackPoster } from '../src/security-alerts/slack-poster';
import type { SnsMessage } from '../src/security-alerts/sns-message';
import { signIn, startTestApp, type TestContext, user } from './support/test-app';

const WEBHOOK = '/api/webhooks/aws-security';
const SLACK_URL = 'https://hooks.slack.com/services/T0000/B0000/XXXXXXXXXXXXXXXX';
const GUARDDUTY_ID =
  'arn:aws:guardduty:eu-central-1:860922939595:detector/b2c6d5e1f0a94c3d8e7f6a5b4c3d2e1f/finding/34c6d5e1f0a94c3d8e7f6a5b4c3d2e10';

type Finding = Record<string, unknown>;

const withFindings = (change: (finding: Finding, index: number) => Finding) => {
  const event = fixtureEvent('security-hub-two-findings');
  const detail = event.detail as { findings: Finding[] };
  return { ...event, detail: { findings: detail.findings.map(change) } };
};

describe('AWS security alerts', () => {
  let context: TestContext;
  let admin: string;
  let developer: string;
  let otherAdmin: string;
  const confirmed: string[] = [];
  const notified: string[] = [];
  const slackPosts: { url: string; body: unknown }[] = [];
  const http = () => request(context.app.getHttpServer());

  const deliver = (message: SnsMessage | string) =>
    http()
      .post(WEBHOOK)
      .set('Content-Type', 'text/plain; charset=UTF-8')
      .set('x-amz-sns-message-type', typeof message === 'string' ? 'Notification' : message.Type)
      .send(typeof message === 'string' ? message : JSON.stringify(message));

  const alertRows = () =>
    context.owner.selectFrom('security_alerts').selectAll().orderBy('alert_key').execute();

  beforeAll(async () => {
    Object.assign(process.env, {
      SECURITY_ALERTS_PROJECT: 'acme',
      SECURITY_ALERTS_ACCOUNT_NAMES: '860922939595=Production,121017505984=Staging,768807471283=Management',
    });
    context = await startTestApp((builder) =>
      builder
        .overrideProvider(FETCH_CERTIFICATE)
        .useValue(async () => TEST_CERTIFICATE)
        .overrideProvider(CONFIRM_SUBSCRIPTION)
        .useValue(async (url: string) => {
          confirmed.push(url);
        })
        .overrideProvider(SecurityAlertsQueue)
        .useValue({
          notify: async ({ alertId }: { alertId: string }) => {
            notified.push(alertId);
          },
          close: async () => undefined,
        })
        .overrideProvider(POST_TO_SLACK)
        .useValue(async (url: string, body: unknown) => {
          slackPosts.push({ url, body });
        }),
    );
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    developer = await signIn(context, context.acme, user('dev', 'developer'));
    otherAdmin = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    await context.owner.deleteFrom('security_alerts').execute();
    await context.owner.deleteFrom('security_alert_messages').execute();
    await context.owner.deleteFrom('slack_integrations').execute();
    confirmed.length = 0;
    notified.length = 0;
    slackPosts.length = 0;
  });

  describe('webhook', () => {
    it('confirms a verified subscription by visiting its link', async () => {
      await deliver(subscriptionConfirmation()).expect(200);
      expect(confirmed).toEqual([SUBSCRIBE_URL]);
    });

    it('refuses a confirmation whose link leaves SNS', async () => {
      const message = subscriptionConfirmation({ SubscribeURL: 'https://attacker.test/confirm' });
      await deliver(message).expect(400);
      expect(confirmed).toEqual([]);
    });

    it('only logs an unsubscribe confirmation', async () => {
      const message = sign<Extract<SnsMessage, { Type: 'UnsubscribeConfirmation' }>>({
        ...subscriptionConfirmation(),
        Type: 'UnsubscribeConfirmation',
      });
      await deliver(message).expect(200);
      expect(confirmed).toEqual([]);
    });

    it('refuses tampered messages, other topics and old messages with a readable 403', async () => {
      const signed = notification(fixtureEvent('root-console-login'));
      const tampered = { ...signed, Message: signed.Message.replace('Success', 'Failure') };
      const otherTopic = notification({}, { TopicArn: 'arn:aws:sns:eu-central-1:111122223333:security-events' });
      const old = notification({}, { Timestamp: new Date(Date.now() - 2 * 60 * 60_000).toISOString() });
      for (const message of [tampered, otherTopic, old]) {
        const { body } = await deliver(message).expect(403);
        expect(body).toEqual({ message: "This message couldn't be verified." });
      }
      await deliver('not json').expect(403);
      await http().post(WEBHOOK).send({ Type: 'Notification' }).expect(403);
      expect(await alertRows()).toEqual([]);
    });

    it('stores one alert per finding and queues notifications for new high and critical ones', async () => {
      await deliver(notification(fixtureEvent('security-hub-two-findings'))).expect(200).expect({ received: true });
      const rows = await alertRows();
      expect(rows.map((row) => [row.source, row.severity, row.account_id, row.tenant_id])).toEqual([
        ['guardduty', 'HIGH', '860922939595', context.acme.tenant.id],
        ['securityhub', 'CRITICAL', '121017505984', context.acme.tenant.id],
      ]);
      expect(notified.sort()).toEqual(rows.map(({ id }) => id).sort());
    });

    it('does nothing twice for a redelivered message', async () => {
      const message = notification(fixtureEvent('root-console-login'));
      await deliver(message).expect(200);
      await context.owner.updateTable('security_alerts').set({ title: 'changed here' }).execute();
      await deliver(message).expect(200);
      const rows = await alertRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.title).toBe('changed here');
      expect(notified).toHaveLength(1);
    });

    it('updates a finding AWS sends again, without a second notification', async () => {
      await deliver(notification(fixtureEvent('security-hub-two-findings'))).expect(200);
      await context.owner
        .updateTable('security_alerts')
        .set({ status: 'acknowledged' })
        .where('alert_key', '=', GUARDDUTY_ID)
        .execute();
      const updated = withFindings((finding) => ({
        ...finding,
        UpdatedAt: '2026-11-16T11:00:00.000Z',
        Workflow: { Status: 'NOTIFIED' },
        Severity: { Label: 'CRITICAL' },
      }));
      await deliver(notification(updated)).expect(200);

      const rows = await alertRows();
      expect(rows).toHaveLength(2);
      const guardDuty = rows.find(({ alert_key }) => alert_key === GUARDDUTY_ID);
      expect(guardDuty).toMatchObject({
        severity: 'CRITICAL',
        status: 'acknowledged',
        aws_updated_at: new Date('2026-11-16T11:00:00.000Z'),
        facts: expect.objectContaining({ workflowStatus: 'NOTIFIED' }) as unknown,
      });
      expect(notified).toHaveLength(2);
    });

    it('ignores an older version of a finding that arrives late', async () => {
      await deliver(notification(fixtureEvent('security-hub-two-findings'))).expect(200);
      const older = withFindings((finding) => ({ ...finding, UpdatedAt: '2026-11-16T08:00:00.000Z', Title: 'Old title' }));
      await deliver(notification(older)).expect(200);
      expect((await alertRows()).map(({ title }) => title)).not.toContain('Old title');
    });

    it('stores an unknown event as informational without notifying', async () => {
      const event = { id: 'e-42', 'detail-type': 'IAM Access Analyzer Finding', account: '040496249361', detail: {} };
      await deliver(notification(event)).expect(200);
      expect(await alertRows()).toMatchObject([{ source: 'other', severity: 'INFORMATIONAL' }]);
      expect(notified).toEqual([]);
    });
  });

  describe('alerts page', () => {
    const list = (query = '', cookie = admin) => http().get(`/api/security-alerts${query}`).set('Cookie', cookie);

    beforeEach(async () => {
      await deliver(notification(fixtureEvent('security-hub-two-findings'))).expect(200);
      await deliver(notification(fixtureEvent('root-console-login'))).expect(200);
    });

    it('lists alerts newest first with account names, and filters them', async () => {
      const { body } = await list().expect(200);
      expect(body.alerts.map((alert: { title: string }) => alert.title)).toEqual([
        'Root user signed in to the console (Success)',
        expect.stringContaining('command and control') as string,
        'IAM.6 Hardware MFA should be enabled for the root user',
      ]);
      expect(body.alerts[0]).toMatchObject({ accountName: 'Management', source: 'root-activity', status: 'new' });

      expect((await list('?severity=HIGH').expect(200)).body.alerts).toHaveLength(1);
      expect((await list('?source=root-activity&account=768807471283').expect(200)).body.alerts).toHaveLength(1);
      expect((await list('?region=eu-central-1&status=new').expect(200)).body.alerts).toHaveLength(2);
      expect((await list('?from=2026-11-16T10:00:00Z').expect(200)).body.alerts).toHaveLength(1);
      expect((await list('?severity=SEVERE').expect(400)).body).toEqual({ message: 'Check the filters and try again.' });
    });

    it('offers the accounts and regions seen, and counts new urgent alerts', async () => {
      expect((await http().get('/api/security-alerts/options').set('Cookie', admin).expect(200)).body).toEqual({
        accounts: [
          { id: '121017505984', name: 'Staging' },
          { id: '768807471283', name: 'Management' },
          { id: '860922939595', name: 'Production' },
        ],
        regions: ['eu-central-1', 'us-east-1'],
      });
      expect((await http().get('/api/security-alerts/unseen').set('Cookie', admin).expect(200)).body).toEqual({ count: 3 });
    });

    it('shows an alert with its raw event, and records who changes its status', async () => {
      const [root] = (await list('?source=root-activity').expect(200)).body.alerts as { id: string }[];
      const detail = (await http().get(`/api/security-alerts/${root?.id}`).set('Cookie', admin).expect(200)).body;
      expect(detail).toMatchObject({
        facts: { sourceIpAddress: '198.51.100.23', consoleLogin: 'Success' },
        rawEvent: fixtureEvent('root-console-login'),
        history: [],
      });

      const changed = await http()
        .post(`/api/security-alerts/${root?.id}/status`)
        .set('Cookie', admin)
        .send({ status: 'acknowledged' })
        .expect(201);
      expect(changed.body).toMatchObject({
        status: 'acknowledged',
        statusChangedBy: 'ada@example.test',
        history: [{ from: 'new', to: 'acknowledged', changedBy: 'ada@example.test' }],
      });
      const audit = await context.owner
        .selectFrom('audit_events')
        .select(['action', 'target_id'])
        .where('action', '=', 'security.alert.status_changed')
        .execute();
      expect(audit).toEqual([{ action: 'security.alert.status_changed', target_id: root?.id }]);
    });

    it('keeps alerts to people allowed to see them, in the receiving project only', async () => {
      await list('', developer).expect(403);
      expect((await list('', otherAdmin).expect(200)).body.alerts).toEqual([]);
      const [first] = (await list().expect(200)).body.alerts as { id: string }[];
      await http().get(`/api/security-alerts/${first?.id}`).set('Cookie', otherAdmin).expect(404);
      await http()
        .post(`/api/security-alerts/${first?.id}/status`)
        .set('Cookie', developer)
        .send({ status: 'resolved' })
        .expect(403);
    });
  });

  describe('Slack', () => {
    const notifier = () =>
      new SecurityAlertsNotifier(
        context.app.get(TenantDatabase),
        context.app.get(SecurityAlertsStore, { strict: false }),
        context.app.get(SlackIntegrations, { strict: false }),
        context.app.get(SlackPoster, { strict: false }),
        context.app.get(AccountNames, { strict: false }),
        context.app.get(APP_CONFIG),
      );

    it('connects a webhook without ever showing it again, and sends a test message', async () => {
      await http().put('/api/integrations/slack').set('Cookie', admin).send({ webhookUrl: 'https://example.test/hook' }).expect(400);
      const { body } = await http().put('/api/integrations/slack').set('Cookie', admin).send({ webhookUrl: SLACK_URL }).expect(200);
      expect(body).toMatchObject({ connected: true, updatedBy: 'ada@example.test' });
      expect(JSON.stringify(body)).not.toContain('hooks.slack.com');
      const stored = await context.owner.selectFrom('slack_integrations').select('encrypted_webhook_url').executeTakeFirstOrThrow();
      expect(stored.encrypted_webhook_url).not.toContain('hooks.slack.com');

      await http().post('/api/integrations/slack/test').set('Cookie', admin).expect(204);
      expect(slackPosts).toEqual([{ url: SLACK_URL, body: { text: expect.stringContaining('PulseGrid is connected') as string } }]);
      await http().put('/api/integrations/slack').set('Cookie', developer).send({ webhookUrl: SLACK_URL }).expect(403);
    });

    it('posts a new alert to the project Slack with a link back', async () => {
      await http().put('/api/integrations/slack').set('Cookie', admin).send({ webhookUrl: SLACK_URL }).expect(200);
      await deliver(notification(fixtureEvent('root-console-login'))).expect(200);
      await notifier().notify({ tenantId: context.acme.tenant.id, alertId: notified[0] ?? '' });
      const text = (slackPosts[0]?.body as { text: string }).text;
      expect(text).toContain('*CRITICAL* Root activity alert in Management (768807471283), us-east-1');
      expect(text).toContain(`<http://localhost:3000/security-alerts/${notified[0]}|Open in PulseGrid>`);
    });

    it('sends nothing when the project has no Slack', async () => {
      await deliver(notification(fixtureEvent('root-console-login'))).expect(200);
      await notifier().notify({ tenantId: context.acme.tenant.id, alertId: notified[0] ?? '' });
      expect(slackPosts).toEqual([]);
    });
  });
});
