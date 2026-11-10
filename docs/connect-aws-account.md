# Connect AWS accounts

The dashboard reads each AWS account with an access key. Admins add keys under **Settings > Integrations > AWS**, with one key for each account. To add another cloud, see [cloud-providers.md](cloud-providers.md).

Everyone in the project sees its connected accounts. Dashboard roles control what people can do, not which accounts they see.

## Create a key

1. In the AWS account, create a dedicated IAM user for the dashboard. Don't use a personal user or an admin user.
2. Attach the PulseGrid policy shown on the **AWS** integration page. Every account uses the same policy, production included. It allows the list and describe actions, logs and costs PulseGrid reads, and the actions it can take: force deploys, reboots, fault experiments and app secret values. It can't read S3 files or create or delete resources. Who can take which action, in staging and in production, is set by roles in PulseGrid.
3. Create an access key for that user.

Root account keys and temporary keys are refused.

## Add the account

1. Go to **Settings > Integrations > AWS**.
2. Enter a name, the Access Key ID and the Secret Access Key.
3. Choose an environment and the regions to read.
4. Select **Test credentials**. The page shows the account the key belongs to and which services it can read.
5. Select **Save integration**. The first sync starts straight away.

Testing a key lists any actions from the PulseGrid policy that it lacks, because the pages and actions that need them won't work. If a key can delete or create resources, the page also shows a warning, because PulseGrid never needs that. Both checks need `iam:SimulatePrincipalPolicy`, which is in the policy. Without it, PulseGrid can't tell.

An account that already has data but no key shows **Needs credentials**. It keeps its data but stops syncing. Adding a key for the same AWS account takes it over and keeps its resources and environment.

## Overview

Overview shows the health of the selected account: problems, resource counts, work in progress, running pipelines and failures from the last 24 hours. It refreshes itself. If an account hasn't synced recently, it warns you rather than showing healthy. A stopped resource isn't a problem, because it may be off on purpose. Status comes from AWS, so Overview can't tell whether an application is responding.

## Filter resources by tag

When you add or edit an account, **Tag filters** choose which resources appear. Include rules keep only resources matching any rule, and exclude rules remove matching resources. Exclude always wins. A rule is a tag key with a value, or just a key to match any value. With no rules, everything appears.

With an include rule, untagged resources are hidden unless you tick **Keep untagged resources**. VPCs, subnets and security groups are always kept, so the map stays connected.

Filtered resources aren't stored, so they also disappear from health and Environments. Saving rules starts a sync, and removing a rule brings resources back. Filters only decide what the dashboard shows. They don't limit what the access key can reach, and **Activity > AWS** still shows events for filtered resources.

Reading tags for ElastiCache, load balancers and S3 needs `elasticache:ListTagsForResource`, `elasticloadbalancing:DescribeTags` and `s3:GetBucketTagging`, which are in the PulseGrid policy. Without them those resources count as untagged.

## See changes made outside the dashboard

The dashboard checks accounts every 30 seconds for deployments and status changes. It can't see EC2 reboots started outside the dashboard, or who started outside work.

## Costs

**Costs** shows what each connected account has spent this month so far and last month, per service. Services this dashboard reads, such as EC2 and RDS, are listed first, and everything else on the bill follows. EC2 includes the charges AWS lists under **EC2 - Other**, such as disks, NAT gateways and data transfer. The super admin and Admins see it by default. Other roles need the **View costs** permission.

To turn it on:

1. Make sure the key's policy includes `ce:GetCostAndUsage`. It's in both policies on the **AWS** integration page, so keys made before this feature need the updated policy.
2. Turn on Cost Explorer in the AWS Billing console, if it isn't on already. AWS can take up to 24 hours to prepare the data the first time.
3. If the account belongs to an AWS Organization, its management account must allow member accounts to use Cost Explorer. Each key only shows its own account, even a key in the management account.

The dashboard reads costs from AWS every 6 hours and saves the totals, so opening the page never calls AWS. AWS charges $0.01 for each request, which is about $1.20 a month per account. If a read fails, the last figures stay on the page with a message, and it tries again within the hour.

Figures come from AWS and can lag by up to a day, so they may differ slightly from your final bill. Credits and taxes are included as AWS reports them. Tag filters don't apply here, because costs are per account and per service, not per resource.

## AWS activity

**Activity > AWS** shows what people and tools did in the selected account, from AWS Event history. This covers management actions from the last 90 days, including the console, the CLI, CI and Terraform. It needs `cloudtrail:LookupEvents`, which is in the PulseGrid policy, and no other setup. It needs the **View activity** permission.

- Events usually take about 15 minutes to appear, so this isn't for real-time alerts.
- AWS only knows the login used, so a shared IAM user or role shows that name.
- Data access, such as reading S3 files, and changes from inside a server aren't included.
## Service logs

ECS services show a **Logs** section. The dashboard finds the CloudWatch log group from the service's task definition, so services using another log driver show a message instead. Logs need the **View service logs** permission, and work in every environment, because reading them changes nothing. Opening a service's logs is recorded in Activity, once every 15 minutes per person and service while they keep reading. Lines are read when you look at them and are never stored. The longest range is 24 hours.

The PulseGrid policy includes `logs:FilterLogEvents` and `ecs:DescribeTaskDefinition`. The second also lets the key see plain environment variables in task definitions. The dashboard reads only the log settings.

## Load

RDS databases, Aurora clusters and ElastiCache caches show a **Load** section with charts for the last 1 hour, 6 hours, 24 hours or 7 days. Values come from CloudWatch when you open the page and are never stored. Everyone can see load, in every environment, because reading it changes nothing.

| Resource | Charts |
|---|---|
| RDS instance | CPU, free memory, storage used, connections, read and write latency, and serverless capacity used for `db.serverless` |
| Aurora cluster | CPU, free memory, connections, storage used, and serverless capacity used when the cluster scales |
| ElastiCache cache | CPU, engine CPU, memory used, connections and evictions, one line per node |

Above the charts, the section lists the capacity the resource has, such as the instance class, node type, allocated storage or serverless range. A chart is marked **Near limit** when the latest value is high: CPU above 80%, engine CPU or cache memory above 90%, storage above 85% or serverless capacity above 80%. Charts with no data from AWS are left out, and a cache with more than three nodes shows the first three.

Load needs `cloudwatch:GetMetricData`, which is in the PulseGrid policy. **Keys connected before load was added don't have it.** Add it to their IAM policy, or the Load section says the key can't read load.

## Fault experiments

The **Experiments** page lists the AWS FIS experiment templates of the account selected in the top bar, in every synced region, and its 20 most recent experiments per region. Each template shows its targets, its steps with their durations, and the CloudWatch alarms that stop it early. A template with no stop alarm is marked, because only a person can stop it. Templates are created in the AWS console or with Terraform; PulseGrid doesn't create or change them.

Everyone can see templates and experiments. Starting or stopping one needs an access key and the **Run staging fault experiments** permission, or **Run production fault experiments** for an account in a production environment. Starting asks you to type the template's name.

An experiment's page refreshes every 5 seconds while it runs. It shows each step's state and timing, why the experiment ended, and who started it from PulseGrid; experiments started elsewhere show **Outside PulseGrid**. Databases and caches the experiment picked that PulseGrid knows are listed with their Load charts, so you can see the effect. Every start and stop is recorded in Activity, and so is every refused attempt.

### Groups and Run all

**Groups** are named lists of templates in one account, kept in PulseGrid. A template can be in several groups. **Run group** starts every template in the group at the same time, and **Run all** in the page header starts every template in the account. Both ask you to type the group's name, or `All experiments`. One run starts at most 25 templates, to stay under the AWS limit on experiments running at once.

Each run has its own page with the live state of every experiment, linked to its page, and refreshes every 5 seconds while any is running. A template that no longer exists in AWS, or that AWS refuses to start, is shown with the reason, and the others still run. **Stop all** stops every experiment of the run that's still active. Recent runs are listed on the Experiments page.

Creating, changing, deleting and running groups need the same key and permission as single experiments, staging or production depending on the account's environment. Group changes, runs and Stop all are recorded in Activity, along with each experiment they started or stopped. No extra AWS permissions are needed.

The PulseGrid policy includes `fis:ListExperimentTemplates`, `fis:GetExperimentTemplate`, `fis:ListExperiments`, `fis:GetExperiment`, `fis:ListExperimentResolvedTargets`, `fis:StartExperiment` and `fis:StopExperiment`. FIS runs each experiment with the role in its template, so the key itself never gets the permissions the experiment uses.

## App secrets

Secrets from AWS Secrets Manager appear under **Infrastructure > Secrets Manager**. Everyone sees their names and details. Values need the secret permissions.

People with **Read staging app secrets** or **Write staging app secrets** can open a secret in a non-production environment, and the production versions of those permissions cover production environments. Values stay hidden until someone selects **Show**, which reads that value from AWS, shows it for 30 seconds, and records who did it. Values are never stored in the dashboard, its logs or the audit log. Without the matching permission, and on accounts with no environment, only names are shown.

Writing adds, edits or deletes one key and saves a new version in AWS. **Edit** can change the key name, the value or both, and it reads the current value, so it's recorded like **Show**. JSON values are shown indented and open in a larger editor, which won't save broken JSON. A secret that's a JSON object opens in the **JSON** view, where **Edit JSON** replaces the whole secret in one version, and the audit log records which keys were added, changed or removed. **Keys** lists each key for single changes. Numbers and true or false values keep their type. If the secret changed since you opened it, nothing is saved and you're asked to reload. Whole secrets can't be created or deleted here, and secrets managed by another AWS service, such as RDS, can't be changed.

- A secret that isn't a JSON object shows as one value. Binary secrets can't be shown.
- A secret encrypted with its own KMS key must also allow the IAM user.
- Running services usually read secrets when they start, so force deploy them after a change.

## How keys are stored

Secrets are encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY`. They're never returned by the API and never written to logs or the audit log. The dashboard only shows a masked Access Key ID, such as `AKIA…MNOP`.

If you lose `TOKEN_ENCRYPTION_KEY`, stored keys can't be read, and you'll need to add them again.

## Rotate a key

1. Create a second access key on the IAM user.
2. Select **Replace credentials** on the account, and enter the new key. It must belong to the same AWS account.
3. Delete the old key in AWS. The dashboard can't do this for you.

Rotate keys regularly, for example every 90 days.

## Sync progress

When you select **Sync now**, a card shows each account, what's being read and the overall percentage. You can leave and come back, and the card picks up where it was. Parts that can't be read are listed, and the rest of the sync carries on. Scheduled syncs run every 2 minutes and don't show a card.

## Infrastructure map

Select **View map** on the Infrastructure page to see how the selected account fits together. Resources sit inside their VPC, split into public and private subnets, and each shows its health.

- A solid line is an exact connection, such as a load balancer's target group pointing to an ECS service.
- A dashed line means a security group allows the connection. It doesn't prove traffic is flowing.
- S3 buckets appear as one box, with no lines, because their links can't be read from network settings.
