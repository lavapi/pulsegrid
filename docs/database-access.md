# Production database access

Give a person read-only access to the production database for a set time, from **Settings > Database access**. Access ends on its own; it can be extended or revoked early. The person connects with Navicat, DBeaver or any PostgreSQL client through an AWS Session Manager tunnel, signing in with a short-lived IAM token as a shared read-only database user.

All the work happens in two AWS Step Functions workflows in the Production account, built separately. PulseGrid starts them, follows their runs and keeps the record.

## Who can grant access

Granting, extending and revoking need the **Grant production database access** permission. It exists only for production, has no staging twin, and no role starts with it; the super admin gives it in **Roles**. Every grant, extension and revoke asks for a fresh code from the authenticator app (or a backup code), and is recorded in Activity.

The page appears in the project that has the Production account connected. People with the permission in another project see that it isn't set up there.

## What happens

**Grant.** Enter the person's IAM Identity Center user name (usually their email), how long (1 to 8 hours) and why. PulseGrid starts the grant workflow with `{"userName", "expiresAt"}` and follows the run, usually 1 to 2 minutes because it runs a database task. When it succeeds, the grant becomes active with the user id and end time the workflow returns. When it fails, nothing is active and the page says why:

| Workflow error | Message |
|---|---|
| `NotAllowed` | This person isn't in the ProductionDatabaseAccess group. Ask an admin to add them in Identity Center. |
| `UserNotFound` | There's no one with that user name in IAM Identity Center. Check it; it's usually their email. |
| `BadExpiry` | That end time isn't allowed: access can last from 1 minute to 8 hours. |
| Anything else, or a run that times out | AWS couldn't finish this. Try again in a minute. |

A person can have one active grant at a time; to give more time, extend it.

**Extend.** Starts the grant workflow again with the new end time, at most 8 hours from now. If it fails, the old end time stays.

**Revoke.** Starts the revoke workflow with `{"userName"}` and follows the run. It is safe to run twice.

**At the end time.** The grant workflow makes its own EventBridge Scheduler schedule that runs the revoke workflow, so access ends even if PulseGrid is down. PulseGrid also has a job at that time: if the grant is still active, it runs revoke (harmless if AWS already did) and marks the grant expired.

**Reconcile, every 5 minutes.** PulseGrid reads the schedules in the schedule group (one per person, named `db-access-<user id>`, with the end time in its expression). Access with no active PulseGrid grant is listed on the page as **Granted outside PulseGrid**; PulseGrid doesn't remove it. Active grants whose schedule is gone after their end time are marked expired.

## Connecting

Click a person's name on an active grant, or **How to connect**, to see their step-by-step guide:

1. **One-time setup:** install the AWS CLI and the Session Manager plugin, and add an SSO session and a profile for the read-only role to `~/.aws/config`.
2. **Each time:** `aws sso login`, then open the Session Manager tunnel to the reader endpoint on `localhost:15432`, then get a password token with `aws rds generate-db-auth-token`.
3. **The database client:** DBeaver or Navicat settings: `localhost`, port `15432`, the database, user `readonly_access`, the token as the password, SSL mode `require`.

Every command and value has a copy button. To send the guide, use **Copy for Slack** (bold headings and code blocks that paste cleanly into a message), **Copy as text** for other messengers and email, or **Share…** to open the system share sheet where the browser has one. The guide has the person's end time in UTC, and no passwords, tokens or links.

## The Production key

PulseGrid calls the workflows with the access key it already stores for the Production account. Add this statement to that key's IAM policy, with your workflow ARNs and schedule group. It isn't part of the PulseGrid policy every key gets, because it names this setup's workflows:

```json
{
  "Effect": "Allow",
  "Action": ["states:StartExecution"],
  "Resource": [
    "arn:aws:states:<region>:<account>:stateMachine:<grant workflow>",
    "arn:aws:states:<region>:<account>:stateMachine:<revoke workflow>"
  ]
},
{
  "Effect": "Allow",
  "Action": ["states:DescribeExecution"],
  "Resource": [
    "arn:aws:states:<region>:<account>:execution:<grant workflow>:*",
    "arn:aws:states:<region>:<account>:execution:<revoke workflow>:*"
  ]
},
{
  "Effect": "Allow",
  "Action": ["scheduler:ListSchedules"],
  "Resource": "*"
},
{
  "Effect": "Allow",
  "Action": ["scheduler:GetSchedule"],
  "Resource": "arn:aws:scheduler:<region>:<account>:schedule/<schedule group>/*"
}
```

`scheduler:GetSchedule` is needed because listing schedules doesn't return their end times.

## Settings

Set these on the API and the worker. With PulseGrid's Terraform, put them in `database_access_settings` in your tfvars and run `terraform apply`; the API and worker restart with them (see the commented example in `terraform.tfvars.example`). Only keys starting with `DB_ACCESS_` are accepted there. Without the first three, the page lists which are missing to people with the permission, and nothing else changes. The account and region are read from the workflow ARNs.

| Setting | Value |
|---|---|
| `DB_ACCESS_GRANT_STATE_MACHINE_ARN` | The grant workflow. |
| `DB_ACCESS_REVOKE_STATE_MACHINE_ARN` | The revoke workflow, in the same account and region. |
| `DB_ACCESS_SCHEDULE_GROUP` | The EventBridge Scheduler group the grant workflow puts its schedules in. |
| `DB_ACCESS_SSO_START_URL` | The AWS access portal URL, for the connect steps. |
| `DB_ACCESS_TUNNEL_INSTANCE_ID` | The Session Manager tunnel server. |
| `DB_ACCESS_READER_ENDPOINT` | The database reader endpoint. |
| `DB_ACCESS_DATABASE` | The database name. |
| `DB_ACCESS_SSO_REGION` | Optional. The region IAM Identity Center runs in, if it isn't the workflows' region. |
| `DB_ACCESS_PROFILE` | Optional. The AWS CLI profile name the guide uses. Default `production-db`. |
| `DB_ACCESS_ROLE_NAME` | Optional. The role people pick in `aws configure sso`. Default `ProductionDatabaseReadOnly`. |
| `DB_ACCESS_DB_USER` | Optional. The shared database user. Default `readonly_access`. |
| `DB_ACCESS_PORT` | Optional. The database port. Default `5432`. |

Granting works before the four connect values are set; until then the page says which are missing instead of showing the connect steps.
