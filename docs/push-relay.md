# Push relay

The iPhone app is one app for every company. Apple sends notifications to it only when they're signed with the app publisher's push key, and that key can't be handed to every company's server. The push relay holds the key instead. A PulseGrid server without its own key sends its notifications through the relay:

```
PulseGrid server ──► push relay ──► Apple ──► iPhone
```

The relay is in `apps/push-relay`, and its AWS setup is in `infra/terraform/push-relay`.

## How servers use it

1. **Registering.** The first time a server sends, it calls `POST /v1/installations`. The relay answers with an `installationId` and a `secret`. The server keeps them, and nobody sets anything up by hand.
2. **Sending.** For each notification, the server calls `POST /v1/notifications` with `Authorization: Bearer <installationId>.<secret>` and this body:

   ```json
   {
     "deviceToken": "<the phone's push token>",
     "environment": "production",
     "message": { "title": "…", "body": "…", "path": "/settings/database-access", "collapseId": "…" }
   }
   ```

   The relay answers `{ "result": "sent" }`, `"gone"` (the phone no longer takes notifications, so forget it) or `"failed"`.

The message format is in `packages/push/src/relay-protocol.ts`, shared by the relay and the API.

| Answer | Meaning |
|---|---|
| `201` | Registered. |
| `200` | Passed to Apple; `result` says what Apple answered. |
| `400` | The notification is missing something, or a part is too long. |
| `401` | The relay doesn't know this server or its secret. Register again. |
| `429` | The server reached today's limit, or too many servers registered from one address today. |
| `503` | The relay can't work right now. Try again later. |

## Safety

- The relay sends to the one app it's set up for (`apns_bundle_id`) and to nothing else.
- It keeps only each server's ID, a SHA-256 hash of its secret, and daily counters. Counters delete themselves after two days. It never stores or logs the notification text.
- Each server can send `notifications_per_day` notifications a day (2,000 by default), and each internet address can register `registrations_per_day` servers a day (10 by default). API Gateway also limits the overall speed.
- The Apple key stays encrypted in Parameter Store. Terraform makes the parameter but never sees the key.

## Setting it up

You need an AWS account, the Apple push key (a `.p8` file with its key ID), your Apple team ID, and access to the DNS of the relay's domain.

1. **Make a bucket for the Terraform state**, once:

   ```bash
   aws s3api create-bucket --bucket <state-bucket> --region eu-central-1 --create-bucket-configuration LocationConstraint=eu-central-1
   aws s3api put-bucket-versioning --bucket <state-bucket> --versioning-configuration Status=Enabled
   aws s3api put-public-access-block --bucket <state-bucket> --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
   ```

2. **Fill in the settings.** In `infra/terraform/push-relay`, copy `backend.hcl.example` to `backend.hcl` and `terraform.tfvars.example` to `terraform.tfvars`, then fill them in.
3. **Build the relay:** `pnpm --filter "./packages/*" build && pnpm --filter @pulsegrid/push-relay build`.
4. **Make the certificate first:** `terraform init -backend-config=backend.hcl`, then `terraform apply -target=aws_acm_certificate.relay`. Add the `certificate_check_record` output to your DNS as a CNAME record.
5. **Make everything else:** `terraform apply`. It waits until the certificate is issued. Then add the `address_record` output to your DNS as a CNAME record.
6. **Put the Apple key in:**

   ```bash
   aws ssm put-parameter --name /push-relay/apns-key --type SecureString --overwrite --value file://AuthKey_<key-id>.p8
   ```

To update the relay later, build it again and run `terraform apply`.

## Cost

You pay only when notifications are sent. At a few thousand notifications a day it's well under $1 a month. A budget email goes to `budget_email` when a month passes `monthly_budget_usd` ($5 by default).
