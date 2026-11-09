# Install on AWS

The dashboard runs as three small Fargate services: the API, the web app and a background worker. You run Terraform once with a few settings. Secrets are generated for you, and migrations run by themselves each time the API starts.

You need [Terraform](https://developer.hashicorp.com/terraform/install), AWS credentials that can create these resources, a domain you control, and an HTTPS certificate for it in [ACM](https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-request-public.html) in the same region.

| | New stack | Existing resources |
|---|---|---|
| Use it when | You're starting from nothing | You already have Aurora PostgreSQL, ElastiCache and a load balancer |
| Creates | Network, load balancer, Postgres, Valkey and the services | The services, one secret and two load balancer rules |
| Costs, Frankfurt | About $120 a month | About $55 a month |

Costs are on-demand estimates before traffic and storage growth.

## New stack

1. Create your settings, and fill them in.

   ```bash
   cd infra/terraform/new-stack
   ```

   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

2. Create everything.

   ```bash
   terraform init
   ```

   ```bash
   terraform apply
   ```

3. Point your hostname at the `load_balancer_dns_name` output with a CNAME record.
4. Follow [Finish setup](#finish-setup).

The services run in public subnets so that no NAT gateway is needed, and they only accept traffic from the load balancer. The database and cache stay in private subnets. For more resilience, set `db_multi_az` to `true` and `service_desired_count` to `2`.

## Existing resources

### What you accept by sharing

- **Stored keys live in this account.** They're encrypted, but `TOKEN_ENCRYPTION_KEY` sits in the same account. Anyone with admin rights here can reach every AWS key stored in the dashboard, so use read-only keys for production and limit who has admin rights.
- **The dashboard goes down with the stack.** Rebooting the shared database or cache from the dashboard takes the dashboard down for a moment too.
- **Backups are shared.** Restoring the Aurora cluster also restores the dashboard's data.

### Check first

1. Find the cache's eviction policy. `noeviction` is best. With a `volatile-` policy, jobs are safe until the cache runs out of memory, so keep some room free. Avoid `allkeys-` policies, which can silently drop jobs. Changing the policy affects everything on that cache.

   ```bash
   aws elasticache describe-cache-clusters --cache-cluster-id CACHE_NODE --query 'CacheClusters[0].CacheParameterGroup.CacheParameterGroupName' --output text
   ```

   ```bash
   aws elasticache describe-cache-parameters --cache-parameter-group-name GROUP --query "Parameters[?ParameterName=='maxmemory-policy'].ParameterValue" --output text
   ```

2. See whether the cache needs a token. If this prints `true`, set `cache_auth_token`.

   ```bash
   aws elasticache describe-replication-groups --replication-group-id CACHE --query 'ReplicationGroups[0].AuthTokenEnabled'
   ```

3. Find how your existing stack defines its security groups. This adds rules to the database, cache and load balancer groups. If the code that owns them uses inline `ingress` or `egress` blocks on `aws_security_group`, its next apply removes these rules, so change that code first.
4. Choose two free rule priorities in a row on the HTTPS listener, and set the first as `listener_rule_priority`.

   ```bash
   aws elbv2 describe-rules --listener-arn LISTENER_ARN --query 'Rules[].Priority' --output text
   ```

5. Make sure the listener has a certificate for your hostname. If it doesn't, set `certificate_arn`.
6. Set `subnet_ids` to private subnets with internet access through NAT.

### Install

1. Create your settings, and fill them in.

   ```bash
   cd infra/terraform/existing-stack
   ```

   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

2. Create everything with the services stopped.

   ```bash
   terraform init
   ```

   ```bash
   terraform apply -var desired_count=0
   ```

3. Print the database setup, then run it once on the Aurora writer as the master user, from a machine inside the VPC.

   ```bash
   terraform output -raw database_setup_sql
   ```

4. Start the services.

   ```bash
   terraform apply
   ```

5. Point your hostname at the `load_balancer_dns_name` output with a CNAME record.
6. Follow [Finish setup](#finish-setup).

To limit who can reach the hostname, set `allowed_cidrs` to up to three addresses. The web app also calls the API through the hostname, so include the public addresses of the NAT gateways, or pages won't load.

## Finish setup

1. Open your hostname. The setup wizard asks for a one-time code.
2. Find the code in the `/ecs/dashops-api` log group in CloudWatch.
3. Create your first project and super admin.
4. Add your AWS accounts under **Settings > Integrations**. Use the read-only policy on production keys. See [connect-aws-account.md](connect-aws-account.md).

## Keep the state safe

Terraform's state file holds the generated passwords and `TOKEN_ENCRYPTION_KEY`. It stays in the folder you ran Terraform from, so keep it private, and never commit it. If several people manage the install, move it to an [encrypted S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3).

If you lose `TOKEN_ENCRYPTION_KEY`, stored keys can't be read, and you'll need to add them again.

## Upgrade

Set `app_version` to the new version, then run `terraform apply`. The API runs any migrations before it starts.

Read the release notes first, and check that your database has a recent backup.

### Installs from before the PulseGrid images

Images are published as `ghcr.io/lavapi/pulsegrid-api` and `-web`. Versions up to 0.8.0 were published as `ghcr.io/lavapi/dashops-api` and `-web`, and only exist under those names.

- **To move to a newer version:** set `app_version` as usual. If you set `image_repository` yourself, change it to `ghcr.io/lavapi/pulsegrid`.
- **To stay on 0.8.0 or earlier:** set `image_repository = "ghcr.io/lavapi/dashops"`, or Terraform will look for the old version under the new name.
- **Keep `name` as it is.** It defaults to `dashops` and names every resource in the stack, including the database, so changing it would replace them.

## Use your own images

Set `image_repository` to your own registry. The images must be `linux/amd64`, and named `<repository>-api` and `<repository>-web`, tagged with `app_version`. Build them from the repository root.

```bash
docker buildx build --platform linux/amd64 -f apps/api/Dockerfile -t REPOSITORY-api:VERSION --push .
```

```bash
docker buildx build --platform linux/amd64 -f apps/web/Dockerfile -t REPOSITORY-web:VERSION --push .
```

## Uninstall

For a new stack, first turn off deletion protection on the database in the RDS console, then run `terraform destroy`. A final database snapshot is kept, and you can delete it yourself.

For existing resources, run `terraform destroy`, then drop the `devdash` database and the `devdash_owner` and `devdash_app` roles.
