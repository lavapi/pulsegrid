# Sign-in

People sign in with an email and password, or with Google. The dashboard manages its own accounts, so no identity provider is needed.

## Projects and people

A new install has no users, so every page opens the setup wizard at `/setup`:

1. **Setup code:** the API prints a one-time code in its log when it starts. Only someone with server access can see it, so a stranger who finds the link can't take over the app.
2. **Project:** the name of your first project.
3. **Super admin:** your name, email and password.
4. **Two-factor:** required for everyone.
5. **Integrations:** optional AWS and GitHub setup.

Setup can only run once. Staging and Production environments are created for you. If you close the browser after step 3, sign in to carry on.

### Projects

A project has its own cloud accounts, integrations, environments, pipelines, releases, costs, roles, members and Activity. Nothing is shared between projects.

The project name at the top left of the sidebar opens the project switcher. It lists the projects you're a member of, and switching keeps you signed in. The super admin also sees **New project**, which asks for a name and starts an empty project with Staging and Production. Add its cloud accounts and Git connection under **Integrations**, and its people under **Members**.

The cloud account picked in the top bar is remembered separately for each project.

The super admin can rename or delete the open project under **Settings > Project**. Deleting asks you to type the project's name, and can't be undone. It removes everything in the project: its cloud accounts and stored access keys, Git connections, environments, domains, pipeline apps, releases, costs, roles, members and Activity. Nothing changes in AWS or GitHub, and people stay under **People**. You move to another project, and anyone who had it open sees the project chooser. The only remaining project can't be deleted.

### People and members

People are one pool for the whole install. Each person has one email, password, Google sign-in and two-factor, and uses them for every project they're in.

There's no public sign-up and there are no invitations. Adding someone takes two steps, both done by the super admin:

1. **Settings > People:** add their first name, last name and email. The account is ready straight away, and the app shows a temporary password once, for the super admin to send privately. The person must replace it at their first sign-in.
2. **Settings > Members**, in each project they need: pick them from People and choose their role in that project.

Someone who isn't a member of a project can't see it or open any of its pages. Someone who is in no project at all can still sign in, set their password and turn on two-factor, and then sees a page saying they haven't been added yet.

Removing someone under **Members** takes them out of that project only, and keeps their sign-in and other projects. Removing someone under **People** removes their sign-in and every membership, and signs them out.

### Super admin

There's one **super admin** for the whole install. They see every project and are an Admin in each, have every permission, create projects, manage People and Members, and edit roles. Nobody can change or remove the super admin. They can hand the role to someone else under **People**; the new super admin is added to every project, and the previous one keeps their project roles until you remove them.

## Roles

Each person has one role, and a role is a list of permissions. Only the super admin can create, edit or delete roles, under **Settings > Roles**, and changes apply straight away. A role can't be deleted while people have it. The super admin always has every permission, whatever their role says.

Three roles are created for you, and you can edit or delete them like any other:

| Role | Starts with |
|---|---|
| Viewer | Nothing extra. Everyone can see infrastructure and pipelines |
| Developer | View activity, sync cloud accounts, run pipelines, manage pipeline apps |
| Admin | Also view costs, the team and roles, manage integrations and manage environments |

Roles belong to a project, so the same person can be a Viewer in one project and an Admin in another. Only the super admin can add, change or remove people.

## Cloud actions

Running pipelines, force deploying a service, rebooting a database, cache or server, running failover tests, and reading or writing app secrets each have a staging and a production permission. They're off for every role until the super admin ticks them, except **Run staging pipelines**, which Admins and Developers start with. They apply to every account in the project.

Which permission applies depends on the environment: production environments need the production permission, others the staging one. Nothing runs on an account with no environment. The super admin has every permission, production included. Only the super admin decides which environments are production. See [Environments](environments.md#production).

Each row is two permissions in **Roles**: the staging one shown here, and the same with production, such as **Reboot a production database**.

| Permission | Note |
|---|---|
| Run staging pipelines | Runs, re-runs and cancels pipelines. See [Pipelines](pipelines.md). |
| Force deploy a staging service | |
| Reboot a staging database | |
| Reboot a staging cache | Rebooting can lose data stored in the cache, and caches in cluster mode can't be rebooted |
| Reboot a staging server | |
| Run staging failover tests | Starts and stops failover tests and groups on the **Failover tests** page. See [Failover tests](connect-aws-account.md#failover-tests). |
| Read staging app secrets | Shows a secret's keys, and a value when you select **Show**. |
| Write staging app secrets | Also adds, edits and deletes keys, and includes reading. |

The buttons appear on a resource's page in Infrastructure. Every action is recorded in the audit log with the person who ran it, because AWS only sees the shared key.

### Progress

After an action starts, a card on the resource's page shows its progress, and anyone who can see the resource can follow it. The background worker checks AWS every 10 seconds, so the result is recorded even if nobody has the page open. When an action finishes, the account syncs.

| Action | Finished when | Time limit |
|---|---|---|
| Force deploy a service | AWS reports the deployment complete, or the running tasks match the desired count for services with no rollout state | 30 minutes |
| Reboot a database or cache | It's `available` again | 15 minutes |
| Reboot a server | AWS's status checks pass | 10 minutes |

The ECS, RDS, ElastiCache and EC2 pages show resources as cards, and each card shows the progress of any action running on it.

### Work started outside the dashboard

The worker also checks connected accounts every 30 seconds, so deployments and changes started from the AWS console, the CLI or CI appear in the same way, marked **Started outside the dashboard**.

| Started outside | Shown |
|---|---|
| ECS deployment | Yes, with task counts |
| RDS or ElastiCache reboot or change | Yes, with the status AWS reports |
| EC2 stop or start | Yes |
| EC2 reboot | No. AWS keeps reporting `running`, so a reboot can't be seen |

It can take up to 30 seconds to appear, and very short changes may never show. AWS's status doesn't say who started the work, so no name is shown. These checks only use read actions from the PulseGrid policy, and pause for two minutes if AWS returns an error.

Only one action can run on a resource at a time, and outside work counts. Past the time limit, the card shows "Timed out", because the action may still be running in AWS. Passing status checks mean a server is up, not that the application on it is healthy. If the key can't read status checks, the card says the reboot was sent but can't be confirmed.

## Lost access

**A person who loses their authenticator** can still sign in with their password and a backup code.

**A person who forgets their password, or needs to move to a new authenticator:** there's no reset, so the super admin removes them under **People** and adds them again with the same email. They get a new temporary password and set up two-factor again, as on their first sign-in. Their projects and roles aren't kept, so add them under **Members** again. Activity keeps their earlier history.

**A temporary password that expires** works the same way, because it lasts 24 hours and can't be renewed. Remove the person under **People** and add them again.

**A super admin who loses access:** nothing in the app can restore it, so the app has to be reinstalled. Keep the password and backup codes somewhere safe, or make someone else the super admin while you still can.

## Security

- Passwords are hashed with Argon2id, must have at least 12 characters, and are checked against known breaches. Only the first 5 characters of a SHA-1 hash leave the server. If that check is unavailable, the password is accepted.
- Five wrong passwords, or five wrong two-factor codes, lock an account for 15 minutes. Entering the right password doesn't reset the count of wrong codes. Messages don't reveal whether an email has an account.
- Two-factor authentication uses an authenticator app, with 10 single-use backup codes. It's required for everyone at first sign-in, can't be turned off, and also applies to Google sign-in. Each code works once, even if it's sent twice at the same moment. Backup codes are stored as keyed hashes, so a copy of the database alone isn't enough to guess them.
- Turning on two-factor signs you out everywhere else.
- A sign-in has to be finished in the browser that started it, for both the two-factor step and Google.
- The API refuses changes that a browser sends from another site. Open PulseGrid at `PUBLIC_URL`; signing in through any other address fails.
- Sign-in requests are limited per IP address, counted in Redis so the limit holds across every API instance.
- Sign-ins, failures, password changes, temporary passwords, new people and role changes appear in the audit log.

## Google

1. In Google Cloud, create an OAuth client of type **Web application**.
2. Add `<PUBLIC_URL>/api/auth/google/callback` as an authorized redirect URI.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart the API.

The Google button appears once both are set. A verified Google email signs in to the matching account, and people without an account have to be added first. Someone added with a temporary password still chooses a new password once, even if they use Google. A temporary password doesn't stop Google sign-in, so remove the person under **People** to end their access.

## Enterprise single sign-on

Login methods are stored in `account_identities`, so a future SSO provider can be added alongside passwords and Google.
