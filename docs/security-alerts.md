# AWS security alerts

PulseGrid receives security alerts from the AWS organization, stores them, shows them under **Security alerts**, and posts new critical and high alerts to Slack. AWS pushes the alerts to PulseGrid through SNS. PulseGrid never calls AWS for this feature and needs no AWS key for it.

## What arrives

EventBridge rules in the organization send three kinds of events to one SNS topic:

| Source | Event | Severity in PulseGrid |
| --- | --- | --- |
| GuardDuty | `Security Hub Findings - Imported` with `ProductName` GuardDuty | The finding's severity label |
| Security Hub | `Security Hub Findings - Imported` with `ProductName` Security Hub, failed checks | The finding's severity label |
| Root activity | `AWS Console Sign In via CloudTrail` or `AWS API Call via CloudTrail` by the root user | Always critical |

Any other event on the topic is kept as an informational alert.

Each Security Hub finding becomes one alert, keyed by the finding ID. When AWS sends a finding again after an update, PulseGrid updates the alert instead of adding another, and keeps its status in PulseGrid. A late, older version of a finding never replaces a newer one. Root activity and other events are keyed by the EventBridge event ID.

## Settings

| Variable | Meaning |
| --- | --- |
| `SECURITY_ALERTS_PROJECT` | The slug of the project that receives the alerts. Until it is set, the endpoint answers 503. |
| `SECURITY_ALERTS_TOPIC_ARNS` | The SNS topics PulseGrid accepts, separated by commas. Default: `arn:aws:sns:eu-central-1:040496249361:security-events`. |
| `SECURITY_ALERTS_ACCOUNT_NAMES` | Names for account IDs, as `123456789012=Production,210987654321=Staging`. Renaming an account here renames it on every alert. |

Set them on both the API and the worker, then run `pnpm db:migrate`.

## The endpoint

`POST https://<your PulseGrid>/api/webhooks/aws-security`

The endpoint needs no sign-in. It trusts nothing until the message is verified, and checks, in this order:

1. The body is an SNS message.
2. The topic is in `SECURITY_ALERTS_TOPIC_ARNS`.
3. The message is no more than an hour old.
4. The signing certificate is on an `https://sns.<region>.amazonaws.com/` host. PulseGrid downloads it once and keeps it until it expires.
5. The signature matches, for SignatureVersion 1 (SHA1) or 2 (SHA256).

A message that fails any check gets a 403, and the log says why, without the message body.

- **Subscription confirmations** are confirmed by visiting their `SubscribeURL`, which must also be on an SNS host.
- **Unsubscribe confirmations** are only logged.
- **Notifications** are stored once per SNS `MessageId`, so SNS retries change nothing.

The endpoint answers within a few seconds. Notifications are sent from the background worker.

## Setting up the AWS side

- Create the SNS topic in the region and account named in `SECURITY_ALERTS_TOPIC_ARNS`.
- Point the EventBridge targets at the topic with the whole event as the message: no input transformer.
- Subscribe `https://<your PulseGrid>/api/webhooks/aws-security` with the `https` protocol and **raw message delivery off**.
- Use SignatureVersion 2 if you can; version 1 also works.
- Keep the delivery retry policy under an hour, because PulseGrid refuses older messages. The default policy is.
- Create the subscription once PulseGrid is running with these settings, so it confirms itself. If it shows as pending, use **Request confirmation** in the SNS console.

## Working with alerts

**Security alerts** lists alerts newest first, with filters for severity, source, account, region, status and dates. The count beside the menu entry shows new critical and high alerts.

An alert's page shows what AWS sent, a link to the finding or event in the AWS console, and the raw event. People with **Acknowledge and resolve security alerts** can move it between New, Acknowledged and Resolved. PulseGrid keeps who changed it and when, and the change also appears in Activity.

The Admin role gets both new permissions: **View security alerts** and **Acknowledge and resolve security alerts**.

## Slack

Under **Settings → Integrations → Slack**, paste a Slack incoming webhook URL. PulseGrid stores it encrypted and never shows it again. From then on, every new critical or high alert is posted to the channel once, with a link back to the alert. Updates to the same finding don't post again. **Send test message** checks the connection.
