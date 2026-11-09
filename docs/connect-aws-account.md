# Connect AWS accounts

The dashboard reads each AWS account with an access key. Admins add keys under **Settings > Integrations > AWS**, with one key for each account. To add another cloud, see [cloud-providers.md](cloud-providers.md).

Everyone in the project sees its connected accounts. Dashboard roles control what people can do, not which accounts they see.

## Create a key

1. In the AWS account, create a dedicated IAM user for the dashboard. Don't use a personal user or an admin user.
2. Attach the read-only policy shown on the **AWS** integration page. It only allows list and describe actions, plus reading logs and costs, and can't read S3 files or secret values. Use this policy for production accounts. The extended policy is only for non-production accounts.
3. Create an access key for that user.

Root account keys and temporary keys are refused.

## Add the account

1. Go to **Settings > Integrations > AWS**.
2. Enter a name, the Access Key ID and the Secret Access Key.
3. Choose an environment and the regions to read.
4. Select **Test credentials**. The page shows the account the key belongs to and which services it can read.
5. Select **Save integration**. The first sync starts straight away.

If a key can delete or create resources, the page shows a warning, because the dashboard never needs that. The extended policy for force deploys and reboots does not trigger it. The check needs `iam:SimulatePrincipalPolicy`, which is included in the policy. Without it, the dashboard can't tell.

An account that already has data but no key shows **Needs credentials**. It keeps its data but stops syncing. Adding a key for the same AWS account takes it over and keeps its resources and environment.

## Filter resources by tag

When you add or edit an account, **Tag filters** choose which resources appear. Include rules keep only resources matching any rule, and exclude rules remove matching resources. Exclude always wins. A rule is a tag key with a value, or just a key to match any value. With no rules, everything appears.

With an include rule, untagged resources are hidden unless you tick **Keep untagged resources**. VPCs, subnets and security groups are always kept, so the map stays connected.

Filtered resources aren't stored, so they also disappear from health and Environments. Saving rules starts a sync, and removing a rule brings resources back. Filters only decide what the dashboard shows. They don't limit what the access key can reach, and **Activity > AWS** still shows events for filtered resources.

Reading tags for ElastiCache, load balancers and S3 needs `elasticache:ListTagsForResource`, `elasticloadbalancing:DescribeTags` and `s3:GetBucketTagging`, which are in the read-only policy. Without them those resources count as untagged.

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

**Activity > AWS** shows what people and tools did in the selected account, from AWS Event history. This covers management actions from the last 90 days, including the console, the CLI, CI and Terraform. It needs `cloudtrail:LookupEvents`, which is in the read-only policy, and no other setup. It needs the **View activity** permission.

- Events usually take about 15 minutes to appear, so this isn't for real-time alerts.
- AWS only knows the login used, so a shared IAM user or role shows that name.
- Data access, such as reading S3 files, and changes from inside a server aren't included.
## Service logs

ECS services show a **Logs** section. The dashboard finds the CloudWatch log group from the service's task definition, so services using another log driver show a message instead. Logs need the **View service logs** permission, and work in every environment, because reading them changes nothing. Opening a service's logs is recorded in Activity. Lines are read when you look at them and are never stored.

The read-only policy includes `logs:FilterLogEvents` and `ecs:DescribeTaskDefinition`. The second also lets the key see plain environment variables in task definitions. The dashboard reads only the log settings.

## App secrets

Secrets from AWS Secrets Manager appear under **Infrastructure > Secrets Manager**. The read-only policy lists their names and details, and never their values.

On a non-production account with the extended policy, people with the secret permissions can open a secret. Values stay hidden until someone selects **Show**, which reads that value from AWS, shows it for 30 seconds, and records who did it. Values are never stored in the dashboard, its logs or the audit log. In production and on accounts with no environment, only names are shown.

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
