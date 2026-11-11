# Changelog

All notable changes to this project are documented in this file. The format is based on Keep a Changelog, and the project follows Semantic Versioning.

## [Unreleased]

## [0.14.0] - 2026-11-11

### Added

- Failover tests keep a report when they end, including tests started outside PulseGrid. A group run or Run all has one report for the whole run, with the overall result, every test's result and reason, one shared timeline and the Load charts of every database and cache the tests hit. Reports can be saved as PDF.
- **Test history** lists every report in the project, with a group run as one entry, filters for environment, test or group, result and dates, and CSV export. Reports are kept until someone with Manage environments deletes them.
- Load charts can show a fixed time window, used by reports.

### Changed

- Fault experiments are now called failover tests everywhere people see them, and their pages moved to `/failover-tests`. Old links redirect. Permission keys and audit actions are unchanged, so roles keep their permissions.

## [0.13.0] - 2026-11-10

### Changed

- Production is no longer read-only for everyone. Running pipelines, cloud actions, fault experiments and app secrets each have a staging and a production permission in **Roles**, and the environment's Production flag decides which applies. Existing roles keep their staging permissions and get no production ones. The super admin has every permission, production included.
- Every AWS account uses one PulseGrid IAM policy that covers everything PulseGrid can read and do, replacing the read-only and extended policies. Testing a key lists any policy actions it lacks.
- **Run pipelines**, **Read app secrets** and **Write app secrets** are now named **Run staging pipelines**, **Read staging app secrets** and **Write staging app secrets**. **View service logs** moved to the Workspace group.

## [0.12.0] - 2026-11-10

### Added

- Fault experiment templates can be put into named groups. **Run group** starts every template in a group at the same time, and **Run all** starts every template in the account, each after typing the name to confirm. Each run has a live page with every experiment's state, the reason any didn't start, and **Stop all**.

## [0.11.0] - 2026-11-10

### Added

- An **Experiments** page lists the AWS FIS experiment templates and recent experiments of the selected account. People with the new **Run staging fault experiments** permission can start and stop them outside production, after typing the template's name. Each experiment has a live page with its steps, stop alarms, who started it and the Load charts of the databases and caches it picked.
- The read-only AWS policy can list and read FIS templates and experiments, and the extended policy can start and stop them.
- The confirm dialog can ask people to type a name before confirming.

## [0.10.0] - 2026-11-10

### Added

- RDS databases, Aurora clusters and ElastiCache caches show their load from CloudWatch, with charts for the last hour, 6 hours, 24 hours or 7 days, their capacity, and a mark when they're near a limit.
- The read-only AWS policy includes `cloudwatch:GetMetricData`.

### Fixed

- A resource page no longer fails to load when its account has no access key, such as with demo data.
- Overview names the resource of the latest cloud action again.

## [0.9.0] - 2026-11-10

### Added

- `pnpm db:demo` fills an empty project with made-up accounts, resources, environments and costs for trying the app and taking screenshots.
- A NOTICE file naming Lavapi as the copyright holder.
- Environments have a production setting that only the super admin can change. Existing environments are set from their names when you migrate.

### Changed

- The README is written for people deciding whether to install PulseGrid, with screenshots. Developer details moved to CONTRIBUTING.md.
- Docker images are published as `ghcr.io/lavapi/pulsegrid-api` and `-web`, and the Terraform `image_repository` default points there. Versions up to 0.8.0 stay under the `dashops` names; see Upgrade in docs/install-aws.md.
- Production protection follows each environment's production setting instead of its name, so renaming an environment no longer changes what's allowed in it.
- Only the super admin can remove a production environment or move an account out of one.
- Linking a pipeline to an environment needs **Manage environments** instead of **Manage pipeline apps**.
- A workflow whose name contains a production word stays production, whatever environment it's linked to.

### Fixed

- The infrastructure map no longer warns about a mismatch between the server and the browser when it first loads.

### Security

- Updated zod to 4, NestJS to 11.2.9 (with multer 2.5.0) and vitest to 4, which clears every known advisory in the dependencies.
- Wrong two-factor codes have their own count, which a correct password no longer resets, and failures are counted atomically.
- Authenticator codes and backup codes can't be reused by sending them in parallel.
- Backup codes are hashed with a key derived from `TOKEN_ENCRYPTION_KEY`. Codes saved earlier keep working until used.
- Turning on two-factor signs out other sessions.
- The two-factor challenge and the Google sign-in state are kept in HttpOnly cookies instead of the URL, so a sign-in can only be finished in the browser that started it.
- Requests that change something are refused when a browser sends them from another site.
- Rate limits are stored in Redis, shared by every API instance.
- The web app sends a content security policy and refuses to be shown in a frame, and no longer names its framework in a header.
- Opening service logs is recorded by the server rather than on the browser's say-so, and a log read covers at most 24 hours.
- Stored secrets are decrypted only with full-length integrity tags.
- Docker builds leave out every `.env` file, Terraform variables and state, CI runs with read-only repository access, and GitHub Actions are pinned to exact commits.
- Local Postgres and Redis from Docker Compose only listen on this machine.
- The Terraform runtime secret can be restored for 7 days after it's deleted.
- Adding a cloud account checks that its environment belongs to the same project.
- The database functions that rename and delete a project only act on the project of the current request.

## [0.8.0] - 2026-11-09

### Added

- The project is licensed under Apache-2.0, with a security policy, contributing guide, code of conduct, and issue and pull request templates.

### Changed

- The app is now called PulseGrid, and the code packages are `@pulsegrid/*`. New authenticator entries are labelled PulseGrid. Docker images, Terraform resource names, database users and Redis keys keep their current names, so existing installs aren't affected.

## [0.7.0] - 2026-11-09

### Added

- Settings > Project for the super admin, to rename the open project or delete it with everything in it after typing its name. The only remaining project can't be deleted. Run the migration first.

## [0.6.0] - 2026-11-09

### Changed

- People are one pool for the whole install, and each project has its own members with a role per project. Someone who isn't assigned to a project can't reach it. The super admin is one person for the whole install, can see every project and is seated in each as Admin. Sessions now belong to the person, with the open project kept on the session. Run the migration: everyone keeps their current workspace and role, and the first workspace's owner becomes super admin.
- Removing someone from Team only takes them out of that project; they keep their sign-in.

### Added

- Projects: a switcher at the top left of the sidebar lists your projects, and the super admin can create new ones. Each project has its own cloud accounts, integrations, environments, pipelines, roles, members and Activity.
- Settings > People for the super admin to add people to the pool, remove them, and hand over the super admin role. Settings > Team is now Members, where the super admin assigns people from the pool and chooses their role in that project.
- A page for people who aren't in any project yet.
- The selected cloud account is remembered per project.

## [0.5.0] - 2026-11-09

### Added

- Quick links on Overview for the selected account's environment, with apps and Grafana in separate groups and their own icons, also on the environment page.
- Editing environment domains. Run the migration so the app can update them.

## [0.4.0] - 2026-11-09

### Added

- Cluster-mode Redis or Valkey (`REDIS_CLUSTER=true`), such as an ElastiCache cluster shared with other applications: the API and worker connect through its configuration endpoint, and every key, BullMQ queues included, carries the `{dashops}` hash tag (`REDIS_KEY_PREFIX`), so multi-key commands stay in one slot and the keys stay apart from other applications. `existing-stack` detects a cluster-mode cache, uses its configuration endpoint and database 0, and sets `REDIS_CLUSTER`.

## [0.3.0] - 2026-11-09

### Removed

- Set temporary password on the Team page and its API route. Removing a person and adding them again is now how they get back in.
- The events queue and its Terraform module. EC2 reboots started outside the dashboard, and the names of people who start outside work, are no longer shown.

### Added

- The app version at the bottom of the sidebar, read from the web app's package when it's built.
- App and Grafana domains for each environment under Manage environments, shown as links on the environment's page and on releases that are ready for testing.
- A Releases page following each change from build and test through its ECS rollout to ready for testing, with a Link a service option to connect a pipeline to its ECS service.
- A Costs page showing this month and last month per service for each cloud account, from AWS Cost Explorer every 6 hours, behind a new View costs permission that Admins have by default. Keys need `ce:GetCostAndUsage`.
- Tag filters and an Edit option for cloud accounts, to include or exclude resources by tag.
- Logs on ECS services from CloudWatch, with time ranges, search and live follow, behind a new View service logs permission.

### Changed

- Roles are now created by the super admin with their own permissions, replacing the fixed roles and per-person permissions. Existing people keep their access, and per-person ticks become custom roles when you run the migration.
- Any person can be made super admin, not only Admins.
- Two-factor authentication is required for everyone at first sign-in and can no longer be turned off. The separate two-factor checks on secrets and logs are gone.
- Times can switch between UTC and local time from the top bar, and show the other zone on hover.
- Developers can now see Activity, manage pipeline apps and link pipelines to environments, like Admins.
- Activity replaces the Audit log, with filters for person, account, type and date, readable details, and recent activity on each resource.
- Switching accounts responds immediately. Pipeline data loads separately, using the last known data while it refreshes in the background.
- The Overview page is now a system health dashboard for the selected account, with problems, running pipelines, recent failures and work in progress.
- Secrets: view and edit a whole JSON secret, edit a key's name and value together, see JSON indented, and use a larger JSON editor that refuses broken JSON. Numbers and true or false values keep their type.
- Background sync now runs every 2 minutes instead of every 5.

## [0.2.0] - 2026-11-06

### Added

- Secrets Manager under Infrastructure, with read and write permissions set by the super admin. Values are read on demand, never stored, and only available outside production with two-factor authentication.
- Install on AWS with Terraform, on a new stack or on an existing database, cache and load balancer, using published images.
- Events queue for AWS accounts, which shows outside EC2 reboots and the name of the person who started outside work.
- Terraform module that forwards AWS changes to a queue for the dashboard.
- Resource cards with live progress on the ECS, RDS, ElastiCache and EC2 pages, and detection of work started outside the dashboard.
- Live progress for cloud actions, recorded by the background worker, and a reboot action for staging ElastiCache clusters.
- Environment badges in the account switcher, and a production banner while a production account is selected.
- Cloud actions: force deploy a service, reboot a staging database and reboot a server, with permissions the super admin sets for each person.
- Add user on the Team page: the super admin enters a first name, last name, email and role, and gets a temporary password to send.
- Temporary passwords set by the super admin, which expire after 24 hours, turn off two-factor and must be replaced at the next sign-in.
- Show and hide on every password field, and confirm password wherever a new password is set.
- First-run setup wizard with a one-time code that is replaced if it gets lost, workspace owners with ownership transfer, and default Staging and Production environments.
- Email and password sign-in, Google sign-in and two-factor authentication.
- Git integrations under Settings: connect GitHub with an encrypted token for each organization, with a provider layer ready for GitLab and Bitbucket.
- AWS integrations under Settings: add, test, replace and remove an access key for each account, with encrypted storage and a read-only IAM policy to copy.
- Live sync progress with per-account status, and page-specific skeleton loaders.
- Infrastructure map showing resources by VPC and subnet, with health and connections from load balancer targets and security group rules.

### Added

- Logs on ECS services from CloudWatch, with time ranges, search and live follow, behind a new View service logs permission.

### Changed

- Roles are now created by the super admin with their own permissions, replacing the fixed roles and per-person permissions. Existing people keep their access, and per-person ticks become custom roles when you run the migration.
- Any person can be made super admin, not only Admins.
- Two-factor authentication is required for everyone at first sign-in and can no longer be turned off. The separate two-factor checks on secrets and logs are gone.
- Times can switch between UTC and local time from the top bar, and show the other zone on hover.
- Activity replaces the Audit log, with filters for person, account, type and date, readable details, and recent activity on each resource.
- Switching accounts responds immediately. Pipeline data loads separately, using the last known data while it refreshes in the background.
- The account switcher lists the selected account first.
- Production is read-only: force deploys, reboots and pipeline run, re-run and cancel only work outside production, for everyone, and typed confirmations are gone.
- Only the super admin can add, remove or change people.
- Public sign-up, invitations, email verification, forgot password and email sending are removed. A super admin who loses access has to reinstall the app.
- Pipeline pages moved under apps, and environment pages only show pipelines that belong to an app.
- Cloud support now runs through a provider layer, with AWS as the first provider, ready for GCP and Azure.
- Everyone in a workspace now sees all connected AWS accounts.
- Production pipeline actions now need only the Admin role and the typed confirmation.

### Removed

- Sign-in through AWS IAM Identity Center, group role mappings, `pnpm tenant:create` and the local identity provider.
- The `GITHUB_TOKEN`, `GITHUB_ORGS` and `GITHUB_TENANT` settings.
- Connect AWS, My AWS access, per-person AWS permissions and background role access.

## [0.1.0] - 2026-11-05

### Added

- Logs on ECS services from CloudWatch, with time ranges, search and live follow, behind a new View service logs permission.

### Changed

- Roles are now created by the super admin with their own permissions, replacing the fixed roles and per-person permissions. Existing people keep their access, and per-person ticks become custom roles when you run the migration.
- Any person can be made super admin, not only Admins.
- Two-factor authentication is required for everyone at first sign-in and can no longer be turned off. The separate two-factor checks on secrets and logs are gone.
- Times can switch between UTC and local time from the top bar, and show the other zone on hover.
- Activity replaces the Audit log, with filters for person, account, type and date, readable details, and recent activity on each resource.
- Switching accounts responds immediately. Pipeline data loads separately, using the last known data while it refreshes in the background.
- Redesigned the web app with a new design system, dark and light themes, a collapsible sidebar and consistent components.

### Added

- Average deployment time per environment on app cards and app pages.
- Apps on the Pipelines page: admins create an app from a name and a repository, and each app's card opens its pipelines.
- The Pipelines page follows the account switcher, showing the selected environment's pipelines and shared checks.
- Environment rules based on the branch are read from workflow files, and production protection is applied to each run.
- Command search, sortable and filterable tables, loading states, toasts and confirmation dialogs.
- Themed dropdowns with keyboard support, replacing browser menus.
- Run, re-run and cancel pipelines, with role checks, production confirmation and an audit trail.
- Production pipeline actions now also need write access to the Production AWS account.
- GitHub Actions pipelines with live run status, history, job and step progress, and environment links.
- Multi-tenant data model with Postgres row-level security.
- Sign-in through AWS IAM Identity Center over SAML 2.0.
- Viewer, Developer and Admin roles mapped from Identity Center groups.
- Append-only audit log.
- Web app with sign-in, workspace overview, access settings and audit log pages.
- Local identity provider for development and tests.
- Terraform, container images and CI.
- AWS account connection through a read-only cross-account role.
- Background sync of ECS, RDS, ElastiCache, S3, EC2 and network resources.
- Infrastructure pages with filters, search and resource details.
- Connect AWS through Identity Center.
- Access levels per account and service, worked out from each person's real AWS permissions.
- Encrypted storage for AWS tokens.
- Environments grouped from AWS accounts, with health summaries and resource views.
- Environment comparison showing missing resources and configuration differences.
- Infrastructure organized by AWS service, with service icons, health and tailored detail pages.
- Account switcher that scopes the workspace to one AWS account, with an empty state when there are none.
- ECS launch type from capacity providers, plus task definition, platform version and deployment state.
