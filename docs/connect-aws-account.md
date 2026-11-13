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
        "ecs:ListServiceDeployments",
        "ecs:DescribeServiceDeployments",
        "ecs:DescribeServiceRevisions",
        "logs:FilterLogEvents",
        "cloudwatch:GetMetricData",
        "cloudwatch:DescribeAlarms",
        "fis:ListExperimentTemplates",
        "fis:GetExperimentTemplate",
        "fis:ListExperiments",
        "fis:GetExperiment",
        "fis:ListExperimentResolvedTargets",
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "rds:DescribeDBParameters",
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
        "elasticloadbalancing:DescribeLoadBalancerAttributes",
        "pi:DescribeDimensionKeys",
        "pi:GetResourceMetrics",
        "iam:SimulatePrincipalPolicy",
        "ecs:UpdateService",
        "rds:RebootDBInstance",
        "elasticache:RebootCacheCluster",
        "ec2:RebootInstances",
        "ec2:DescribeInstanceStatus",
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue",
        "fis:StartExperiment",
        "fis:StopExperiment",
        "ec2:StartInstances"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::*-alb-logs-*",
        "arn:aws:s3:::*-alb-logs-*/*"
      ]
    }
  ]
}
```

| Actions | Used for |
|---|---|
| `ecs:` list and describe, `ecs:ListTagsForResource`, `ecs:DescribeTaskDefinition` | Inventory, the map, Releases, and log settings |
| `ecs:ListServiceDeployments`, `ecs:DescribeServiceDeployments`, `ecs:DescribeServiceRevisions` | Blue/green, canary and linear deployments on ECS service pages and Releases |
| `rds:DescribeDBInstances`, `rds:DescribeDBClusters` | Inventory and capacity |
| `rds:DescribeDBParameters` | The connection limit on [Load](#load), from each database's parameter group |
| `elasticache:` describe and `ListTagsForResource` | Inventory, capacity and tag filters |
| `ec2:` describe actions | Servers, VPCs, subnets, security groups and the map |
| `ec2:DescribeInstanceTypes`, `ec2:DescribeVolumes` | Total memory, vCPUs and disk sizes on [Load](#load) |
| `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketTagging` | Buckets and tag filters. Files in buckets are never read. |
| `elasticloadbalancing:` describe actions | Load balancers, target health and tag filters. `DescribeLoadBalancerAttributes` finds where each load balancer keeps its logs for the [Request log](#request-log). |
| `s3:ListBucket`, `s3:GetObject` on `*-alb-logs-*` buckets only | Reading load balancer log files for the [Request log](#request-log). No other bucket's files can be read. |
| `pi:DescribeDimensionKeys`, `pi:GetResourceMetrics` | [Top SQL](#query-activity) from Performance Insights |
| `secretsmanager:ListSecrets` | Secret names and details |
| `logs:FilterLogEvents` | [Service logs](#service-logs) and the [PostgreSQL log](#query-activity) |
| `cloudwatch:GetMetricData` | [Load](#load) charts, including those in failover test reports |
| `cloudwatch:DescribeAlarms` | Checking that failover tests' stop alarms are OK before and after each test |
| `cloudtrail:LookupEvents` | [AWS activity](#aws-activity) and changes made outside PulseGrid |
| `ce:GetCostAndUsage` | [Costs](#costs) |
| `fis:` list and get actions | [Failover tests](#failover-tests), reports and history |
| `fis:StartExperiment`, `fis:StopExperiment` | Starting and stopping tests, groups, Run all and Stop all |
| `ec2:StartInstances` | Starting servers again that a failed or stopped failover test left stopped |
| `ecs:UpdateService` | Force deploy |
| `rds:RebootDBInstance`, `elasticache:RebootCacheCluster`, `ec2:RebootInstances` | Reboots |
| `ec2:DescribeInstanceStatus` | Checking that a rebooted server came back |
| `secretsmanager:GetSecretValue`, `secretsmanager:PutSecretValue` | Showing and changing [app secret](#app-secrets) values |
| `iam:SimulatePrincipalPolicy` | Testing a key for missing or extra permissions |

A few things sit outside this policy:

- A secret encrypted with its own KMS key needs that key's policy to allow the IAM user.
- A load balancer log bucket in another account, such as a log archive account, must also grant the key in its bucket policy. See [Request log](#request-log).
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

## Display names

ECS clusters and services, EC2 servers, and RDS clusters and instances can have a display name in PulseGrid, such as **Frontend** for a cluster called `jack-mike-one`. Select **Rename** under the name on the resource's page. The display name is shown everywhere PulseGrid shows the resource: lists and cards, search, the map, Overview, Environments, Releases, failover test reports and Activity. The AWS name stays visible beside it, and search finds either.

Display names live only in PulseGrid; nothing changes in AWS, so they need no extra permission on the key. A display name follows the resource's ARN, so syncs, redeploys, and a resource being deleted and recreated with the same ARN keep it. Older entries, such as past Activity and test reports, show the current display name with the name the resource had at the time. Each project names resources on its own.

Renaming needs **Manage environments**. **Reset to AWS name** removes a display name. Every change is recorded in Activity with the old and new names.

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
## ECS deployments

An ECS service that uses ECS's own **blue/green**, **canary** or **linear** deployments shows a deployment card on its page:

- The **stages**: scale up green, test traffic to green, live traffic to green, bake time, and clean up blue. Stages where your lifecycle hooks run are marked.
- **Blue** (live before the deployment) and **green** (the new revision) side by side, with their task definition, images, tasks running, and the share of test and live traffic each asked for.

**Live traffic** is what your users send through the load balancer's main listener. ECS calls it "production traffic" in every environment, staging included, so PulseGrid says live traffic to avoid mixing it up with the production environment. **Test traffic** goes through the separate test listener, so you can try green before users reach it. After a deployment completes, ECS can still show the old side with all test traffic: the test listener's rule is left pointing at it, and nothing is sent there unless someone calls the test listener.
- How it ended: completed, stopped, or rolled back with ECS's reason.
- Earlier deployments of the service.

The card refreshes every 5 seconds while a deployment runs, and every 30 seconds otherwise. Everyone can see it, in every environment. Services with rolling deployments don't show it; their rollouts appear on Releases as before. Deployments managed by CodeDeploy aren't covered. See [Releases](pipelines.md#releases) for how these stages show there.

## Service logs

ECS services show a **Logs** section. The dashboard finds the CloudWatch log group from the service's task definition, so services using another log driver show a message instead. Logs need the **View logs** permission, and work in every environment, because reading them changes nothing. Opening a service's logs is recorded in Activity, once every 15 minutes per person and service while they keep reading. Lines are read when you look at them and are never stored. The longest range is 24 hours.

The PulseGrid policy includes `logs:FilterLogEvents` and `ecs:DescribeTaskDefinition`. The second also lets the key see plain environment variables in task definitions. The dashboard reads only the log settings.

## Request log

Application Load Balancer pages have a **Request log** tab: every HTTP request, read from the load balancer's access logs in S3 when you look. PulseGrid asks the load balancer where it sends its logs (bucket and prefix), then reads only the 5-minute files that overlap the chosen range, from AWS's standard path `<prefix>/AWSLogs/<account>/elasticloadbalancing/<region>/YYYY/MM/DD/`. Files are streamed and decompressed on the server. Nothing is stored in PulseGrid, and log lines are never written to its own logs.

- **Requests:** time, host, method and path, the load balancer's and the target's status, response time, the target group, user agent and client address, newest first, 100 at a time. **Older** reads further back.
- **Filters:** time range (15 minutes by default, 24 hours at most), host, path, status (2xx to 5xx, or an exact code), service, minimum response time and user agent.
- **Summary** for the range: requests, 5xx rate, p50, p95 and p99 response time, the 10 busiest paths and hosts, and requests with no target, which the load balancer answered on its own, such as an unknown host. A busy 24 hours can have more files than one read covers; the summary then says it's from the newest part.
- **TLS connections** shows the connection logs: client address, TLS protocol and cipher, handshake time and result.
- With Cloudflare in front, the client address is Cloudflare's edge, not the visitor, and is labelled that way.
- Paths are shown without their query string, which can hold emails, ids or tokens. **Show query strings** needs the **See query strings and values in logs** permission, which Admins have.
- Files arrive every 5 minutes, so the last few minutes may not be there yet. Logs are kept as long as the bucket keeps them; PulseGrid reads back 90 days at most.

Reading the logs needs **View logs**. When the logs are in another account's bucket, that bucket's policy must grant the key. If it doesn't, the tab says so and shows the exact ARN to grant. For example, in the bucket's policy:

```json
{
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::<account>:user/<pulsegrid-user>" },
  "Action": ["s3:ListBucket", "s3:GetObject"],
  "Resource": ["arn:aws:s3:::<bucket>", "arn:aws:s3:::<bucket>/<prefix>*"]
}
```

The key's own policy allows reading only from buckets named like `*-alb-logs-*`. If your log bucket is named differently, add it to the second statement of the key's policy.

## Query activity

Aurora cluster and database instance pages have a **Query activity** tab.

- **Top SQL** shows each instance's busiest statements from Performance Insights over 1 hour, 6 hours, 24 hours or 7 days: the statement with placeholders instead of values, average active sessions, its share of the instance's load, its top wait events, and calls per second and average latency when Performance Insights has them. Instances without Performance Insights say so. Instances are read one after another so Performance Insights isn't flooded.
- **PostgreSQL log** reads the log RDS exports to CloudWatch Logs (`/aws/rds/cluster/<cluster>/postgresql`) with `logs:FilterLogEvents` only, newest first, up to 500 lines. Choose errors and warnings, errors, warnings, deadlocks, failed connections or everything, and search the text. A database that doesn't export its log says how to turn it on.
- **Slow queries** lists statements PostgreSQL logged because they ran longer than `log_min_duration_statement`, with their duration. The list stays empty until that parameter is set in the database's parameter group; nothing changes in PulseGrid when it is.
- Values in statements and in key details, such as `Key (email)=(…)`, are replaced with `?` unless you have **See query strings and values in logs**.

Query activity needs **View logs**. Nothing is stored in PulseGrid. When AWS asks PulseGrid to slow down, the tab says so; try again a moment later.

## Load

ECS services, EC2 servers, RDS databases, Aurora clusters and ElastiCache caches show a **Load** section with charts for the last 1 hour, 6 hours, 24 hours or 7 days. Values come from CloudWatch when you open the page and are never stored. Everyone can see load, in every environment, because reading it changes nothing.

Memory, storage and connections are shown as **used out of total**, such as **2.5 GB / 24 GB** or **40 / 410**, and CPU says how many vCPUs it's measured against, such as **38% · of 2 vCPUs**.

| Resource | Charts | Where the totals come from |
|---|---|---|
| RDS instance | CPU, memory used, storage used, connections, read and write latency, and serverless capacity used for `db.serverless` | Memory and vCPUs from the instance class, storage from what's allocated, connections from `max_connections` |
| Aurora cluster | CPU, free memory, connections, storage used, and serverless capacity used when the cluster scales | Aurora storage grows by itself up to 128 TB, so it has no fixed total. Each instance's own page shows its memory out of total. |
| ElastiCache cache | CPU, engine CPU, memory used, connections and evictions, one line per node | Memory out of the node's limit, worked out from the share AWS reports as used. vCPUs from the node type. Connections out of 65,000 per node, the fixed Redis and Valkey limit. |
| ECS service | CPU and memory used | What the tasks reserve: running tasks × the CPU and memory in the task definition |
| EC2 server | CPU, memory used and root disk used | Memory and vCPUs from the instance type, disk from the attached EBS volumes |

An RDS instance's connection limit is `max_connections` in its parameter group. When the group sets a number, that's the limit. When it keeps the AWS default, which is a formula based on the instance's memory, PulseGrid works it out from the instance class memory and shows it as **about**, because AWS keeps some memory back for itself. Formulas PulseGrid can't read, and `db.serverless` instances, show connections without a limit. The setting is read again every 10 minutes.

ECS measures CPU and memory against what the tasks reserve, and totals use the number of tasks running now. If the service scaled during the chosen range, earlier points are measured against the current total.

**EC2 memory and disk use need the CloudWatch agent on the server**, because EC2 doesn't measure them itself. The agent's default `mem_used_percent` and `disk_used_percent` metrics are used, for the root disk. Without the agent, the Load section shows CPU, the server's totals, and a note that memory and disk use need the agent.

Above the charts, the section lists the capacity the resource has, such as the instance class, vCPUs, memory, disks, tasks, node type, allocated storage or serverless range. A chart is marked **Near limit** when the latest value is high: CPU or connections above 80%, engine CPU or memory above 90%, and storage or disk above 85%. Charts with no data from AWS are left out, and a cache with more than three nodes shows the first three.

Load needs `cloudwatch:GetMetricData`. Totals need `ec2:DescribeInstanceTypes`, EC2 disk sizes need `ec2:DescribeVolumes`, and RDS connection limits need `rds:DescribeDBParameters`. All four are in the PulseGrid policy. **Keys connected before these were added don't have them.** Without the first, the Load section says the key can't read load; without the others, charts still show, just without totals.

## Failover tests

Failover tests are AWS FIS experiments, run and reported from PulseGrid. The **Failover tests** page lists the FIS experiment templates of the account selected in the top bar, in every synced region, and its 20 most recent tests per region. Each template shows its targets, its steps with their durations, and the CloudWatch alarms that stop it early. A template with no stop alarm is marked, because only a person can stop it. Templates are created in the AWS console or with Terraform; PulseGrid doesn't create or change them. Links to the old `/experiments` pages still work.

Everyone can see templates and tests. Starting or stopping one needs an access key and the **Run staging failover tests** permission, or **Run production failover tests** for an account in a production environment. Starting asks you to type the template's name.

A test's page refreshes every 5 seconds while it runs. It shows each step's state and timing, why the test ended, and who started it from PulseGrid; tests started elsewhere show **Outside PulseGrid**. Databases and caches the test picked that PulseGrid knows are listed with their Load charts, so you can see the effect. Every start and stop is recorded in Activity, and so is every refused attempt.

### Groups and Run all

**Groups** are named lists of templates in one account, kept in PulseGrid. A template can be in several groups. **Run group** runs every template in the group, and **Run all** in the page header runs every template in the account. One run holds at most 25 templates.

**Tests in a run go one at a time.** The next test starts only after the one before it has ended and the whole environment is healthy again. Nothing starts on a timer. The background worker checks every 15 seconds.

**The environment must be healthy before and after every test.** PulseGrid checks, in the test's region:

- every ECS service has as many tasks running as it wants, and exactly one deployment;
- every target behind the account's load balancers is healthy;
- every Aurora or RDS cluster and database instance is *available*;
- every Valkey or Redis replication group, and each of its nodes, is *available*;
- the stop alarms of the run's tests are *OK*.

A part PulseGrid can't read counts as unhealthy, and the run says which permission to add. If the environment isn't healthy within 30 minutes, before a test or after one, the run stops, the remaining tests are cancelled, and the report says what was unhealthy.

**Tests whose targets aren't ready are skipped**, with the reason, and the run goes on. For example a test on a cache that isn't *available*, a test on a server that isn't passing both status checks, or a test that stops one ECS task when the service has fewer than 2 running. A skipped test isn't a failure.

**Servers left stopped are started again.** When a test that stops EC2 servers ends failed or stopped, PulseGrid starts the servers it targeted, retrying while they're still stopping. Each start is in the report. A server that can't be started within 30 minutes is listed under **Needs attention** to start by hand.

**Only one failover test runs at a time in an environment**, across every account in it, every person, groups, Run all and single tests, including experiments started in the AWS console. A run waits for the environment to be free; starting a single test while another runs is refused.

**Zone-wide tests** run last. These are tests that cut a whole Availability Zone off, such as network disruption or tests that target subnets.

The run dialog lists the tests in the order they'll run, and says when something else is running. You type the group's name, or `All tests`, to confirm. **Stop all** stops the running test and cancels the rest; PulseGrid still starts any servers that test left stopped.

**In production**, you also tick that you understand the tests run in production, one at a time, and the run doesn't start while anything else is running there.

Creating, changing, deleting and running groups need the same key and permission as single tests, staging or production depending on the account's environment. Group changes, runs and Stop all are recorded in Activity, along with each test they started or stopped.

### Reports and history

When a test ends, PulseGrid saves its report: the template, account and environment, who started it, when it started and ended, the result, why it ended, each step with its timing, and the resources it picked. This includes tests started in the AWS console or by other tools. The background worker looks for ended tests every 2 minutes, and opening a test or run saves its report at once.

The result is **Passed** when the test completed, **Stopped** when a person or a stop alarm stopped it, and **Failed** when AWS reports a failure or cancelled it.

**A group run or Run all is reported in one place.** Its page is the report for the whole run:

- **Summary:** environment, account, who started it, start, end and duration, and the overall result. A run passes only when every test completed. It fails when any test failed or didn't start, and is stopped when any test was stopped or cancelled. It keeps running until the last test ends.
- **Every test in one table**, in the order it ran, with its result and why, its start, end and duration, how long the environment took to be healthy again, and any servers PulseGrid started again. Skipped, waiting and cancelled tests say why.
- **One timeline** with every test and its steps on the same time axis.
- **Load charts** for the databases and caches the tests hit, from 10 minutes before the run to 10 minutes after it.

While tests are running, the page refreshes every 5 seconds and **Stop all** stops every test that's still active.

A single test's report has the same parts for that one test.

**Download PDF** on either page downloads the report as a table: the run's facts, then one row per test with what was done, the result and why, timing, how long until healthy again, and repairs, followed by anything that needs attention. Times are in UTC or your local time, whichever the top bar shows.

**Test history**, linked from the Failover tests page, lists the reports of the account selected in the top bar, newest first, so staging and production history stay apart. A group run or Run all is one entry, with a count such as "4 tests · 3 passed · 1 stopped"; tests started on their own are their own entries. Filter by test or group, result and dates, so you can compare the same group over time, and **Export CSV** downloads what's shown.

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
