# Pipelines

Pipelines shows your apps, their pipelines and runs, and job and step progress. GitHub Actions is the first supported provider. People with permission can run, re-run and cancel them.

## Connect GitHub

1. In GitHub, go to **Settings > Developer settings > Fine-grained tokens**, and choose the organization and repositories.
2. Give the token **Actions: Read and write**, **Contents: Read-only** and **Metadata: Read-only**.
3. In the dashboard, go to **Settings > Integrations > GitHub**.
4. Enter a name, the organization and the token, select **Test credentials**, then **Save connection**.

Tokens are encrypted, belong to one project, and are never shown again. Add one connection for each organization. To add another Git provider, see [git-providers.md](git-providers.md).

## Running pipelines

Running pipelines needs a token with **Actions: Read and write**. With a read-only token, the pages still work and actions show a clear error.

People whose role has **Run staging pipelines** can run, re-run and cancel non-production pipelines. **Run production pipelines** does the same for production pipelines.

Everyone can see production pipelines and their runs. Refused attempts appear in the audit log.

This rule covers the dashboard only. People with access on GitHub can still run workflows there. To control that, add required reviewers to the `production` environment on GitHub.

A pipeline counts as production if it's linked to a production environment, if its workflow file uses a production environment, if its workflow name contains a word like `prod` or `production`, or if it has no environment at all. See [Environments](environments.md#production) for which environments are production. A shared pipeline that has no environment needs **Run production pipelines**, or a link to a non-production environment. A link to another environment can't make a production workflow count as non-production. A workflow whose environment is an expression the dashboard can't read also counts as production.

Some workflows pick their environment from the branch, for example `${{ github.ref_name == 'main' && 'production' || 'staging' }}`. The dashboard reads this rule and decides for each run: `main` runs follow the production rules, and runs on other branches follow the staging rules.

Only workflows with a `workflow_dispatch` trigger can be started. Re-run and cancel work on any run.

The server checks every action and records it in the audit log. GitHub shows the token's owner as the person who started the run, so the audit log is the record of who really did it. GitHub's own required reviewers on an environment still apply.

## Apps

The Pipelines page shows apps. An app has a name and one repository from a Git connection, and a repository can belong to only one app. People with **Manage pipeline apps** create an app with **Create app**, and delete it from the app's page. Deleting an app changes nothing on GitHub.

Each card shows how many pipelines the app has in the selected account, and whether any are running or failed. Select a card to see the app's pipelines.

Cards and app pages also show the average deployment time for each environment. A deployment is a successful run of a pipeline that belongs to an environment, so shared pipelines such as CI don't count, and failed or cancelled runs are left out. A workflow that picks its environment by branch counts each run in the environment of its branch. The average uses GitHub's latest 50 runs of each workflow, and it always shows every environment, whichever account is selected. Time spent waiting for a required reviewer on GitHub is included.
 Pipelines only appear once their repository has an app, including on environment pages.

## Environments

A pipeline is linked to an environment when its workflow file names that environment, or when its workflow name contains a word like `staging` or `production`. People with **Manage environments** can change or clear the link on the pipeline's page, except for workflows that pick their environment by branch. Linked pipelines appear on the environment's page.

The Pipelines page follows the account switcher. An account in Staging shows Staging pipelines, an account in Production shows Production pipelines, and every account shows shared pipelines, such as CI and pull request checks. A shared pipeline is one with no environment. A workflow that picks its environment by branch appears in both, showing only the runs for the selected environment. An account with no environment shows only shared pipelines.

## Releases

**Releases** shows each change from build to ready for testing, in one line per app. Everyone can see it. It refreshes every 5 seconds while something is moving. It only shows progress, so there are no deploy buttons here.

To add a line, people whose role has **Manage pipeline apps** select **Link a service**, then choose a pipeline and the ECS service it deploys to. Only non-production services are listed for now. EC2 servers and production aren't covered yet.

Build, Test and Image come from the jobs of the latest run, or from its steps if the pipeline has a single job. They're sorted by name, so a job called `unit-tests` counts as Test and one called `push-image` counts as Image. Anything else counts as Build, and a stage with nothing in it isn't shown.

The ECS stage is read live from AWS. This uses `ecs:DescribeServices` and `ecs:DescribeTaskDefinition`, which are in the PulseGrid policy. **Ready for testing** appears when the pipeline has succeeded and ECS says the matching rollout has completed. ECS only completes a rollout once the new tasks are running and, behind a load balancer, healthy.

### Blue/green, canary and linear services

Services that use ECS's own blue/green, canary or linear deployments show the traffic stages instead:

| Stage | Means |
|---|---|
| **ECS Fargate blue/green** (or canary, linear) | Green scales up; the line shows the stage ECS reports |
| **Ready** | Green serves test traffic, so you can test it before production moves |
| **Live** | Live traffic is on green and the bake time is over |

A rollback shows as failed with ECS's reason, for example **Rolled back: alarm fired**. Matching a deployment to a run uses the green revision's image tag, as above. Reading these needs `ecs:ListServiceDeployments`, `ecs:DescribeServiceDeployments` and `ecs:DescribeServiceRevisions`, which are in the PulseGrid policy; without them, the line falls back to the rolling view. Deployments managed by CodeDeploy aren't covered.

To match a rollout to a run, the dashboard looks for the run's commit in the image tag:

- If the tag has the commit, for example `api:abc1234` or `api:sha-abc1234`, the match is exact.
- If the tag looks like a different commit, the rollout doesn't belong to this run.
- If the tag doesn't look like a commit, for example `latest`, any rollout that started after the run began counts, and the line says it was matched by time. This is less reliable, so we recommend tagging images with the commit.

If a pipeline succeeds and no rollout appears within 15 minutes, the line shows **Not deployed**.

Once a change is ready for testing, its line links to the app domains of its environment, if any are set under **Manage environments**. See [Environments](environments.md#domains).

## Limits

- Everyone in the project sees every repository the token covers.
- Pages refresh every 5 seconds while something is running and every 30 seconds otherwise. A new run on an idle repository can take up to about a minute to appear.
- Progress is live for jobs and steps. GitHub only provides full logs after a job finishes, so logs open on GitHub.
- Results are cached to stay within GitHub's rate limit of about 5,000 calls an hour.
