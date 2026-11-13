# Release Notes

## [Unreleased]

## [0.21.0] - 2026-11-13

- Send people their database connect steps in one click: open a grant's guide and use **Copy for Slack**, **Copy as text** or **Share…**.

## [0.20.1] - 2026-11-13

- Set database access up through Terraform: put the `DB_ACCESS_*` values in `database_access_settings` and run `terraform apply`.

## [0.20.0] - 2026-11-13

- Give someone read-only access to the production database for a few hours, from **Settings > Database access**. It ends on its own and can be extended or revoked. It runs the database access workflows in AWS; see docs/database-access.md for the settings and the statement to add to the Production key. Run `pnpm db:migrate` and give the new **Grant production database access** permission.
- When the dashboard shares a load balancer behind a CDN, it can require the CDN's secret header, so requests that skip the CDN never reach it.

## [0.19.0] - 2026-11-11

- Read load balancer requests and database query activity in PulseGrid. Load balancer pages have a Request log with filters and a summary of errors, response times and the busiest paths. Database pages show the busiest statements from Performance Insights, the PostgreSQL log and slow queries. Query strings and values in statements stay hidden unless you have the new **See query strings and values in logs** permission.
- Run `pnpm db:migrate` after updating. Add `elasticloadbalancing:DescribeLoadBalancerAttributes`, `pi:DescribeDimensionKeys` and `pi:GetResourceMetrics` to every key's IAM policy, plus the new statement for `*-alb-logs-*` buckets. A log bucket in another account must also grant the key in its bucket policy.

## [0.18.0] - 2026-11-11

- Failover test runs go one test at a time, and each starts only when the whole environment is healthy again: ECS services, load balancer targets, databases, caches and stop alarms. A test whose targets aren't ready is skipped with the reason. Servers a failed test left stopped are started again. Only one test runs at a time in an environment, and production runs need an extra confirmation.
- Download a failover test report as a clean PDF table of what was done, how it ended and how fast the environment recovered.
- Run `pnpm db:migrate` after updating. Add `cloudwatch:DescribeAlarms` and `ec2:StartInstances` to every key's IAM policy; `servicequotas:ListServiceQuotas` is no longer needed.
- Production is shown more calmly: a thin red line on the top bar instead of a red banner, and a clear Production box in every dialog that changes production, which also asks for the resource's name. Scrolling on production pages no longer leaves a gap above the top bar.

## [0.17.0] - 2026-11-11

- Failover test runs no longer overlap tests on the same resource: each waits for the resource to recover first, and zone-wide tests such as zone outages run alone at the end.
- Blue/green deployments say live traffic instead of ECS's "production traffic", which applies in every environment and was easy to mistake for production.

## [0.16.1] - 2026-11-11

- Fixed Overview and resource lists failing to load with "This page didn't load" after a force deploy, reboot or other cloud action.
- Test history follows the account selected in the top bar, so staging and production history no longer mix.

## [0.16.0] - 2026-11-11

- See ECS blue/green deployments: each stage, blue and green side by side, and rollbacks with the reason. Releases is ready for testing as soon as green has test traffic. Add `ecs:ListServiceDeployments`, `ecs:DescribeServiceDeployments` and `ecs:DescribeServiceRevisions` to every key's IAM policy.
- Group runs and Run all no longer fail tests past AWS's limit of experiments running at once. You choose how many run at a time, and the rest start as earlier ones end. Run `pnpm db:migrate` after updating, and add `servicequotas:ListServiceQuotas` to every key's IAM policy so PulseGrid can read the account's quota.

## [0.15.0] - 2026-11-11

- See database and cache connections out of their limit, such as 40 / 410. Add `rds:DescribeDBParameters` to every key's IAM policy, or RDS connections show without a limit.
- See memory and storage as used out of total, such as 2.5 GB / 24 GB, and how many vCPUs a database, cache, service or server has. ECS services and EC2 servers now have load charts too. EC2 memory and disk use need the CloudWatch agent on the server.
- Add `ec2:DescribeInstanceTypes` and `ec2:DescribeVolumes` to every key's IAM policy, or charts show without totals.

## [0.14.0] - 2026-11-11

- Fault experiments are now **Failover tests**. Old links and existing roles keep working.
- Every failover test now gets a report when it ends, and a group run or Run all gets one report for the whole run, with every test, one timeline and the load on what they hit. **Test history** keeps them all, filterable and exportable to CSV. Run `pnpm db:migrate` after updating.

## [0.13.0] - 2026-11-10

- Production is now controlled by roles instead of being read-only for everyone. Each action has a staging and a production permission under **Roles**. Nothing changes until you tick production permissions on a role; the super admin already has them.
- Replace the IAM policy on every AWS key, production included, with the single **PulseGrid policy** from Integrations. Test each key afterwards: PulseGrid lists any actions it's missing.

## [0.12.0] - 2026-11-10

- Group fault experiments and start a whole group, or every template, in one click. Watch them together on one page and stop them all at once. Groups follow the same rules as single experiments and need no new AWS permissions. Run `pnpm db:migrate` after updating.

## [0.11.0] - 2026-11-10

- Run AWS Fault Injection Service experiments from the new **Experiments** page and watch them live, with the load on the databases and caches they hit. Starting and stopping need the new Run staging fault experiments permission and only work outside production.
- Add the FIS permissions from Integrations to your keys: the five read actions to every key, and `fis:StartExperiment` and `fis:StopExperiment` to keys with the extended policy.

## [0.10.0] - 2026-11-10

- See how busy your databases and caches are. RDS, Aurora and ElastiCache pages now show CPU, memory, storage, connections and more from CloudWatch, with their capacity, and mark anything near its limit.
- Load needs `cloudwatch:GetMetricData`. Add it to the IAM policy of keys you connected earlier. New keys get it from the policy shown under Integrations.

## [0.9.0] - 2026-11-10

- To look around without an AWS account, run `pnpm db:demo` after setup to fill a new project with made-up data.
- Production is now a setting on each environment, under Settings > Manage environments, and only the super admin can change it. Renaming an environment no longer changes what's allowed in it. Your environments are set from their current names when you run `pnpm db:migrate`, so check them afterwards.
- Only the super admin can remove a production environment or move an account out of one.
- Linking a pipeline to an environment now needs Manage environments. Developers can still run non-production pipelines.
- Sign-in is harder to attack: wrong two-factor codes now lock an account even when the password is right, codes can't be reused, and turning on two-factor signs you out everywhere else. Run `pnpm db:migrate` after updating.
- Open PulseGrid at the address in `PUBLIC_URL`. Changes sent from any other address, such as the load balancer's own name, are now refused.
- The Terraform runtime secret can now be restored for 7 days after a `terraform destroy`. The change applies the next time you run `terraform apply`, and nothing is replaced.
- Docker images now use the PulseGrid name. If you set `image_repository` yourself, change it to `ghcr.io/lavapi/pulsegrid` when you upgrade. Don't change `name`. See Upgrade in docs/install-aws.md.

## [0.8.0] - 2026-11-09

- PulseGrid is now licensed under Apache-2.0. The repository has a security policy for reporting vulnerabilities privately, a contributing guide and a code of conduct.
- The app has a new name: PulseGrid. Nothing changes for your install. New two-factor setups show PulseGrid in your authenticator app.

## [0.7.0] - 2026-11-09

- Rename or delete a project under Settings > Project. Deleting removes everything in that project, asks you to type its name first, and can't be undone. Run `pnpm db:migrate` after updating.

## [0.6.0] - 2026-11-09

- Work in more than one project. Each project has its own cloud accounts, integrations, environments, pipelines, roles and people. Switch from the project name at the top left, where the super admin can also create new projects.
- People are now one pool for the whole install. The super admin adds them under Settings > People, then assigns them to each project with a role under Settings > Members. Someone who isn't assigned to a project can't see it. Your existing workspace becomes your first project, and everyone keeps their current role. Run `pnpm db:migrate` after updating.

## [0.5.0] - 2026-11-09

- Open your apps and Grafana straight from Overview under Quick links, for the environment you're looking at. Apps and Grafana now have their own groups and icons.
- Edit a domain's type, name or address under Settings > Manage environments. Run `pnpm db:migrate` after updating.

## [0.4.0] - 2026-11-09

- DashOps can share a cluster-mode Redis or Valkey with other applications, with its data kept apart from theirs.

## [0.3.0] - 2026-11-09

- See which version you're running at the bottom of the sidebar.
- Add the app and Grafana domains of each environment under Settings > Manage environments. Open them from the environment's page, and go straight to the app from Releases once a change is ready for testing. Run `pnpm db:migrate` after updating.
- See every change from build to ready for testing under Releases. Link a pipeline to its ECS service, and follow build, test, rollout and the moment it's ready, all in one line. This covers non-production ECS services for now.
- Set temporary password is gone from the Team page. To let someone back in, remove them and add them again.
- See what each AWS account and service costs under Costs, for this month so far and last month. The super admin and Admins see it by default, and you can tick View costs on any other role. Copy the updated policy from Integrations and turn on Cost Explorer in AWS to use it.
- Create your own roles under Settings > Roles and choose exactly what each one can do. Admin, Developer and Viewer are now ordinary roles you can edit, and permissions are set on roles instead of on each person. Production stays read-only for every role.
- Everyone now sets up two-factor authentication the first time they sign in, and it stays on. If someone loses their phone, they can use a backup code. With none left, the super admin removes them and adds them again.
- Choose which resources appear with tag filters when adding or editing an AWS account. Copy the updated policy from Integrations so tags can be read for caches, load balancers and S3.
- Switch between local time and UTC from the top bar. Hover over any time to see the other one.
- Developers now have the same access as Admins, except for Team, Integrations and Manage environments.
- See who did what in AWS under Activity > AWS, including console and CLI changes from the last 90 days. Copy the updated policy from Integrations to use it.
- See CloudWatch logs on each ECS service, with search and live follow. The super admin grants View service logs, and keys need the updated policy from Integrations.
- Activity replaces the Audit log. See who did what, filter it, and see recent activity on each resource.
- Switching accounts is much faster, and pipelines fill in as soon as they're ready.
- Overview is now a system health dashboard. See problems, running pipelines, recent failures and work in progress for the selected account.
- View and edit a whole JSON secret in one go, or edit a key's name and value together. JSON values are now shown indented, and open in a larger editor that won't save broken JSON.
- The events queue is gone. Deployments and status changes started outside the app still show, but EC2 reboots started outside it and the names of the people who start outside work don't.
- New and changed resources now appear within about 2 minutes.

## [0.2.0] - 2026-11-06

- See your secrets under Infrastructure > Secrets Manager. On staging, people with the new permissions can show values and add, edit or delete keys. Production shows names only. Copy the updated IAM policies from Integrations to use this.
- Install on AWS with one Terraform run, on new infrastructure or alongside what you already have. Secrets are generated for you, and migrations run by themselves. See docs/install-aws.md.
- Production is now read-only, even for the super admin. Force deploys, reboots and running, re-running or cancelling pipelines only work outside production. Use the read-only policy from Integrations for production keys. Pipelines with no environment count as production, so link them to a non-production environment to run them.
- See EC2 reboots started outside the app, and who started outside work, by connecting an events queue under Settings > Integrations.
- ECS, RDS, ElastiCache and EC2 now show as cards with live progress, including work started from the AWS console or your CI. EC2 reboots started outside the app can't be detected.
- Follow force deploys and reboots with a live progress card on the resource's page. You can now also reboot staging caches. Copy the updated IAM policy from Integrations to use them.
- The account switcher now shows Production or Staging for each account, and a red bar appears while you're working in production.
- Run force deploys and reboots from Infrastructure. The super admin chooses who can do what under Settings > Team, and your access key needs the extended policy from Integrations.
- Super admins now add people directly under Settings > Team, and send them a temporary password. Invitations are gone, and the app no longer sends email.
- Lost your password? Your super admin can now set a temporary password, and you choose a new one when you sign in.
- Only the super admin can add, remove or change people.
- Forgot password and public sign-up are gone. If the super admin loses access, the app has to be reinstalled.
- You can now show or hide what you type in password fields, and new passwords must be typed twice.
- New installs start with a setup wizard that creates your workspace, super admin and integrations. If the setup code is lost, a new one appears in the server log.
- Each workspace now has an owner, and ownership can be transferred to another Admin.
- Sign in with your email, or continue with Google. AWS sign-in is no longer needed.
- Choose each person's role under Settings > Team.
- Two-factor authentication is now available, and required for Admins.
- Connect GitHub under Settings > Integrations. Each workspace now has its own encrypted token, and the setup is ready for GitLab and Bitbucket.
- The dashboard is now ready for more clouds. AWS is the first provider, and the account switcher shows each account's provider.
- Connect AWS accounts with an access key under Settings > Integrations. Test a key before saving it, and replace it at any time.
- Everyone in a workspace now sees all connected AWS accounts.
- Admins can now run production pipelines without connecting AWS.
- Connect AWS and My AWS access have been removed. Add a key for each account to keep it syncing.
- See live progress when you sync, with each account's status and a percentage.
- Pages now show a preview of their layout while they load.
- See how an AWS account fits together on the new infrastructure map, with live health and the connections between services.

## [0.1.0] - 2026-11-05

- Teams can sign in with their AWS IAM Identity Center account.
- Admins can choose which groups have access and what role each group gets.
- Admins can review sign-ins and access changes in an audit log.
- Admins can connect AWS accounts with a read-only role.
- Everyone can browse ECS, RDS, ElastiCache, S3, EC2 and network resources, with status and tags.
- Anyone can select Connect AWS to see their accounts and services, based on their real AWS permissions, with no setup in each account.
- A My AWS access page shows what you can view or manage in each account.
- Staging and Production now have their own views, with health at a glance.
- Compare two environments to find missing resources and configuration differences.
- Infrastructure now lists your AWS services, such as ECS, RDS and EC2. Select one to see its health and details.
- Use the account switcher at the top right to view one AWS account at a time.
- A completely new look, with dark and light themes.
- Press Cmd+K to jump to any service, resource or page.
- See your GitHub pipelines, with live progress, run history and links to environments.
- Run, re-run and cancel pipelines from the dashboard. Only admins can act on production.
- Acting on production pipelines now needs write access to your Production AWS account.
- The Pipelines page now follows the account switcher: Staging accounts show Staging pipelines, Production accounts show Production pipelines, and CI and pull request checks appear in both.
- Each app now shows its average deployment time for Staging and Production.
- The Pipelines page now shows your apps. Admins can create an app by giving it a name and choosing a repository, then select its card to see its pipelines.
- Workflows that deploy to production from `main` and to staging from other branches are now protected per run, so production rules apply only to production runs.
