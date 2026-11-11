# Connect AWS accounts

The dashboard reads each AWS account with an access key. Admins add keys under **Settings > Integrations > AWS**, with one key for each account. To add another cloud, see [cloud-providers.md](cloud-providers.md).

Everyone in the project sees its connected accounts. Dashboard roles control what people can do, not which accounts they see.

## Create a key

1. In the AWS account, create a dedicated IAM user for the dashboard. Don't use a personal user or an admin user.
2. Attach the [PulseGrid policy](#the-pulsegrid-policy), which is also shown on the **AWS** integration page. Every account uses the same policy, production included. It allows the list and describe actions, logs and costs PulseGrid reads, and the actions it can take: force deploys, reboots, failover tests and app secret values. It can't read S3 files or create or delete resources. Who can take which action, in staging and in production, is set by roles in PulseGrid.
3. Create an access key for that user.

Root account keys and temporary keys are refused.

## The PulseGrid policy

Every account uses this one policy, production included. Roles in PulseGrid decide who may take which action, in staging and in production.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:ListClusters",
        "ecs:DescribeClusters",
        "ecs:ListServices",
        "ecs:DescribeServices",
        "ecs:ListTagsForResource",
        "ecs:DescribeTaskDefinition",
        "logs:FilterLogEvents",
        "cloudwatch:GetMetricData",
        "fis:ListExperimentTemplates",
        "fis:GetExperimentTemplate",
        "fis:ListExperiments",
        "fis:GetExperiment",
        "fis:ListExperimentResolvedTargets",
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "elasticache:DescribeReplicationGroups",
        "elasticache:DescribeCacheClusters",
        "elasticache:DescribeCacheSubnetGroups",
        "elasticache:ListTagsForResource",
        "cloudtrail:LookupEvents",
        "ce:GetCostAndUsage",
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation",
        "s3:GetBucketTagging",
        "secretsmanager:ListSecrets",
        "ec2:DescribeInstances",
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeRouteTables",
        "ec2:DescribeInstanceTypes",
        "ec2:DescribeVolumes",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeTags",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:DescribeTargetHealth",
        "iam:SimulatePrincipalPolicy",
        "ecs:UpdateService",
        "rds:RebootDBInstance",
        "elasticache:RebootCacheCluster",
        "ec2:RebootInstances",
        "ec2:DescribeInstanceStatus",
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue",
        "fis:StartExperiment",
        "fis:StopExperiment"
      ],
      "Resource": "*"
    }
  ]
}
```

| Actions | Used for |
|---|---|
| `ecs:` list and describe, `ecs:ListTagsForResource`, `ecs:DescribeTaskDefinition` | Inventory, the map, Releases, and log settings |
| `rds:DescribeDBInstances`, `rds:DescribeDBClusters` | Inventory and capacity |
| `elasticache:` describe and `ListTagsForResource` | Inventory, capacity and tag filters |
| `ec2:` describe actions | Servers, VPCs, subnets, security groups and the map |
| `ec2:DescribeInstanceTypes`, `ec2:DescribeVolumes` | Total memory, vCPUs and disk sizes on [Load](#load) |
| `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketTagging` | Buckets and tag filters. Files in buckets are never read. |
| `elasticloadbalancing:` describe actions | Load balancers, target health and tag filters |
| `secretsmanager:ListSecrets` | Secret names and details |
| `logs:FilterLogEvents` | [Service logs](#service-logs) |
| `cloudwatch:GetMetricData` | [Load](#load) charts, including those in failover test reports |
| `cloudtrail:LookupEvents` | [AWS activity](#aws-activity) and changes made outside PulseGrid |
| `ce:GetCostAndUsage` | [Costs](#costs) |
| `fis:` list and get actions | [Failover tests](#failover-tests), reports and history |
| `fis:StartExperiment`, `fis:StopExperiment` | Starting and stopping tests, groups, Run all and Stop all |
| `ecs:UpdateService` | Force deploy |
| `rds:RebootDBInstance`, `elasticache:RebootCacheCluster`, `ec2:RebootInstances` | Reboots |
| `ec2:DescribeInstanceStatus` | Checking that a rebooted server came back |
| `secretsmanager:GetSecretValue`, `secretsmanager:PutSecretValue` | Showing and changing [app secret](#app-secrets) values |
| `iam:SimulatePrincipalPolicy` | Testing a key for missing or extra permissions |

Two things sit outside this policy:

- A secret encrypted with its own KMS key needs that key's policy to allow the IAM user.
- Each FIS experiment template has its own role, which FIS uses to inject the faults. The key never gets those permissions.

Pipelines use a GitHub token rather than AWS. It needs **Actions: Read and write**, **Contents: Read-only** and **Metadata: Read-only**. See [pipelines.md](pipelines.md). PulseGrid's own hosting needs nothing extra: Terraform creates the role it runs with. See [install-aws.md](install-aws.md).

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

ECS services, EC2 servers, RDS databases, Aurora clusters and ElastiCache caches show a **Load** section with charts for the last 1 hour, 6 hours, 24 hours or 7 days. Values come from CloudWatch when you open the page and are never stored. Everyone can see load, in every environment, because reading it changes nothing.

Memory and storage are shown as **used out of total**, such as **2.5 GB / 24 GB**, and CPU says how many vCPUs it's measured against, such as **38% · of 2 vCPUs**.

| Resource | Charts | Where the totals come from |
|---|---|---|
| RDS instance | CPU, memory used, storage used, connections, read and write latency, and serverless capacity used for `db.serverless` | Memory and vCPUs from the instance class, storage from what's allocated |
| Aurora cluster | CPU, free memory, connections, storage used, and serverless capacity used when the cluster scales | Aurora storage grows by itself up to 128 TB, so it has no fixed total. Each instance's own page shows its memory out of total. |
| ElastiCache cache | CPU, engine CPU, memory used, connections and evictions, one line per node | Memory out of the node's limit, worked out from the share AWS reports as used. vCPUs from the node type. |
| ECS service | CPU and memory used | What the tasks reserve: running tasks × the CPU and memory in the task definition |
| EC2 server | CPU, memory used and root disk used | Memory and vCPUs from the instance type, disk from the attached EBS volumes |

ECS measures CPU and memory against what the tasks reserve, and totals use the number of tasks running now. If the service scaled during the chosen range, earlier points are measured against the current total.

**EC2 memory and disk use need the CloudWatch agent on the server**, because EC2 doesn't measure them itself. The agent's default `mem_used_percent` and `disk_used_percent` metrics are used, for the root disk. Without the agent, the Load section shows CPU, the server's totals, and a note that memory and disk use need the agent.

Above the charts, the section lists the capacity the resource has, such as the instance class, vCPUs, memory, disks, tasks, node type, allocated storage or serverless range. A chart is marked **Near limit** when the latest value is high: CPU above 80%, engine CPU or memory above 90%, and storage or disk above 85%. Charts with no data from AWS are left out, and a cache with more than three nodes shows the first three.

Load needs `cloudwatch:GetMetricData`. Totals need `ec2:DescribeInstanceTypes`, and EC2 disk sizes need `ec2:DescribeVolumes`. All three are in the PulseGrid policy. **Keys connected before these were added don't have them.** Without the first, the Load section says the key can't read load; without the others, charts still show, just without totals.

## Failover tests

Failover tests are AWS FIS experiments, run and reported from PulseGrid. The **Failover tests** page lists the FIS experiment templates of the account selected in the top bar, in every synced region, and its 20 most recent tests per region. Each template shows its targets, its steps with their durations, and the CloudWatch alarms that stop it early. A template with no stop alarm is marked, because only a person can stop it. Templates are created in the AWS console or with Terraform; PulseGrid doesn't create or change them. Links to the old `/experiments` pages still work.

Everyone can see templates and tests. Starting or stopping one needs an access key and the **Run staging failover tests** permission, or **Run production failover tests** for an account in a production environment. Starting asks you to type the template's name.

A test's page refreshes every 5 seconds while it runs. It shows each step's state and timing, why the test ended, and who started it from PulseGrid; tests started elsewhere show **Outside PulseGrid**. Databases and caches the test picked that PulseGrid knows are listed with their Load charts, so you can see the effect. Every start and stop is recorded in Activity, and so is every refused attempt.

### Groups and Run all

**Groups** are named lists of templates in one account, kept in PulseGrid. A template can be in several groups. **Run group** starts every template in the group at the same time, and **Run all** in the page header starts every template in the account. Both ask you to type the group's name, or `All tests`. One run starts at most 25 templates, to stay under the AWS limit on experiments running at once.

Creating, changing, deleting and running groups need the same key and permission as single tests, staging or production depending on the account's environment. Group changes, runs and Stop all are recorded in Activity, along with each test they started or stopped. No extra AWS permissions are needed.

### Reports and history

When a test ends, PulseGrid saves its report: the template, account and environment, who started it, when it started and ended, the result, why it ended, each step with its timing, and the resources it picked. This includes tests started in the AWS console or by other tools. The background worker looks for ended tests every 2 minutes, and opening a test or run saves its report at once.

The result is **Passed** when the test completed, **Stopped** when a person or a stop alarm stopped it, and **Failed** when AWS reports a failure or cancelled it.

**A group run or Run all is reported in one place.** Its page is the report for the whole run:

- **Summary:** environment, account, who started it, start, end and duration, and the overall result. A run passes only when every test completed. It fails when any test failed or didn't start, and is stopped when any test was stopped.
- **Every test in one table**, with its result, why it ended, and its timing. Tests that didn't start show why.
- **One timeline** with every test and its steps on the same time axis.
- **Load charts** for the databases and caches the tests hit, from 10 minutes before the run to 10 minutes after it.

While tests are running, the page refreshes every 5 seconds and **Stop all** stops every test that's still active.

A single test's report has the same parts for that one test. **Save as PDF** on either page opens the print dialog with the report laid out for printing; choose **Save as PDF** there.

**Test history**, linked from the Failover tests page, lists every report in the project, newest first. A group run or Run all is one entry, with a count such as "4 tests · 3 passed · 1 stopped"; tests started on their own are their own entries. Filter by environment, test or group, result and dates, so you can compare the same group over time, and **Export CSV** downloads what's shown.

Reports are kept in PulseGrid until someone with **Manage environments** deletes them, so history outlives AWS, which drops experiments after about 120 days. Deleting a run deletes the reports of its tests too. Everyone can see reports. Load charts are read from CloudWatch when a report is opened. CloudWatch keeps 1-minute points for 15 days, then 5-minute points until 63 days and hourly points after that, so older reports show coarser charts.

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
