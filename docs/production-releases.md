# Production releases

Production releases its services with a blue/green release that holds after the traffic switch: players are on the new versions, the old ones keep running, and the release waits up to 8 hours for someone to **finish** it (keep the new versions) or **roll it back**. With no decision it rolls back by itself. A 5xx alarm also rolls it back during the hold.

**Production releases** in PulseGrid shows the release in progress and lets a person make that decision, the same as running the Release production workflow in GitHub with `finish` or `rollback`.

## The page

- **The release in progress:** its id, status, components and their image tags, who requested it, and when it started. While it waits, a banner says so and counts down to the automatic rollback.
- **Finish release** and **Roll back:** each asks for confirmation, naming the release and its components. The release acts on the decision within about a minute. The page checks every 10 seconds until the release ends.
- **Recent releases:** the last 20, with their result and decision.
- **The menu:** a red dot beside the entry while a release waits for a decision. Slack reminders come from the release itself; PulseGrid sends none.

The person deciding is always the one signed in; their email is passed to the release as the decider. Every attempt, including refused ones, is recorded in Activity with the release, the decision and its result.

## Who can use it

The page and both buttons need **Finish or roll back production releases**. No role has it by default; add it under **Settings → Roles**.

## Settings

Set these on the API:

| Variable | Meaning |
| --- | --- |
| `PRODUCTION_RELEASES_ROLE_ARN` | The role in the production account PulseGrid assumes. Without it, the page says it isn't set up. |
| `PRODUCTION_RELEASES_PROJECT` | The slug of the project that shows the page. |
| `PRODUCTION_RELEASES_REGION` | Default `eu-central-1`. |
| `PRODUCTION_RELEASES_TABLE` | Default `dreamzino-production-releases`. |
| `PRODUCTION_RELEASES_DECIDE_FUNCTION` | Default `dreamzino-production-release-decide`. |

## Access

PulseGrid stores nothing secret for this. Its API task role may only assume the production role, which needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadReleases",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
      "Resource": "arn:aws:dynamodb:eu-central-1:<production account>:table/dreamzino-production-releases"
    },
    {
      "Sid": "Decide",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:eu-central-1:<production account>:function:dreamzino-production-release-decide"
    }
  ]
}
```

If the table is encrypted with a customer-managed KMS key, add `kms:Decrypt` on that key. The trust policy names only PulseGrid's API task role as principal, with `sts:AssumeRole`.

## When a decision is refused

PulseGrid checks the release before deciding, and the decide function checks again. Refusals are shown in plain words:

- There is no production release in progress.
- This release is no longer waiting for a decision.
- This release was already decided by someone.

If production can't be reached, the page asks to try again, or to use the Release production workflow in GitHub.
