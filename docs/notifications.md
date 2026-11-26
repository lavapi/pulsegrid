# Slack notifications

PulseGrid can send each person a personal Slack message when:

- a pull request they opened has passed every check and is ready to merge,
- a pull request they opened has finished its checks and one failed,
- a deploy they started is ready,
- a deploy they started failed.

Nothing is posted to channels. Each person chooses which of these they get.

## How it works

PulseGrid doesn't need to be reachable from the internet. The worker asks GitHub once a minute instead of waiting for webhooks:

- **Pull requests:** it lists open pull requests in every repository linked to a pipeline. It skips drafts and authors who haven't set a GitHub username. For the rest, it reads the check runs and commit statuses on the latest commit. Repeat requests use GitHub's ETags, and an unchanged answer doesn't count against the rate limit.
  - **Ready:** every check passed (skipped and neutral count as passed) and GitHub would let the pull request merge. Required reviews and branch protection count.
  - **Failed:** every check finished and at least one failed. The message names the failed checks.
- **Deploys:** it reads the same releases the Releases page shows. A release that became ready or failed in the last two hours goes to the GitHub user who started the run.

Each message is sent once. It is recorded only after Slack has accepted it, so a failed send is tried again the next minute. A new push to a pull request counts as a new event, and so does a new run of a deploy. Records are kept for 30 days.

People are matched in two steps:

1. The pull request author or run actor is matched to a PulseGrid user by the **GitHub username** that person saved.
2. That user is matched to Slack by their PulseGrid sign-in email (`users.lookupByEmail`).

## Connect Slack

You need the **Manage integrations** permission.

1. Open **Settings → Integrations → Slack** and copy the manifest.
2. At [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App → From a manifest**, pick your workspace and paste the manifest.
3. Choose **Install to Workspace** and allow it.
4. Under **OAuth & Permissions**, copy the **Bot User OAuth Token** (it starts with `xoxb-`) and paste it into PulseGrid.

PulseGrid checks the token with Slack before saving it. The token is encrypted at rest and never shown again. To change it, paste a new one. **Disconnect** removes it. Connecting and disconnecting are recorded in Activity.

The app's bot scopes are:

- `chat:write` to send the messages,
- `users:read` and `users:read.email` to find people by email.

## Choose your notifications

Under **Your account → Notifications**, each person:

1. Enters their **GitHub username**. PulseGrid checks that it exists on GitHub. Two people in a project can't use the same username.
2. Turns each of the four messages on or off. All four start on.
3. Can send themselves a test message.

The card shows whether Slack can reach them. If it says **Not found in Slack**, their Slack account uses a different email than their PulseGrid sign-in.
