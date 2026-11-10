# Environments

An environment groups one or more AWS accounts, such as Staging or Production.

Environments and Compare work across accounts, so they do not follow the account switcher.

## How they are created

Connected accounts are checked once by name. Names containing words like `prod`, `staging`, `dev` or `uat` are grouped into Production, Staging, Development or QA. Other accounts, such as Audit or Backup, are left out until an admin assigns them.

Admins can rename, add or remove environments under **Manage environments**, and move accounts between them. A manual choice is kept. Removing an environment keeps its accounts and their data.

## Production

Each environment is either production or not. Cloud actions, secret values and pipeline runs in a production environment need the production permissions in Roles, so a role can act on staging without touching production. A new environment counts as production unless its name contains a non-production word like `staging`, `dev`, `qa` or `test`. Renaming an environment doesn't change this.

Only the super admin can:

- Tick or clear **Production** for an environment under **Manage environments**.
- Remove a production environment.
- Move an account out of a production environment, either to another environment or to none.

Everyone with **Manage environments** sees which environments are production. Every change is recorded in Activity.

## Domains

Each environment can list its domains under **Manage environments**, such as the Staging and Production addresses of your apps and their Grafana.

- **Type:** App or Grafana.
- **Name:** optional, such as Website or API. Without one, an app shows its address and Grafana shows as Grafana.
- **Address:** `https://` is added if you leave it out. Addresses with a user name or password, and anything that isn't a web address, are refused.

Apps show with a globe icon and Grafana with a chart icon, in separate groups. Select **Edit** on a domain to change its type, name or address; the same checks apply as when adding.

Domains appear as **Quick links**:

- **Overview:** for the environment of the account selected in the top bar, right under the system status. If that environment has no domains, people who can manage environments see an **Add domains** button instead.
- **Environment page:** under the page title.
- **Releases:** a change that is ready for testing links to its environment's app domains.

Links open in a new tab, and you sign in there as usual.

Domains are only links. The dashboard doesn't check whether a domain is up, and nothing in your cloud changes, so production domains can be added like any other. Everyone can see them. Adding, editing or removing one needs **Manage environments** and is recorded in Activity. Removing an environment removes its domains.

## Health

Each environment shows how many resources need attention, per service. Only services you can view are counted, so two people can see different totals for the same environment.

## Comparing environments

**Compare environments** matches resources by type and name. Words like `staging` or `prod`, the environment names, and 12-digit account IDs are ignored, so `api-staging` matches `api-prod`.

- **Only in one environment:** no match was found. A resource named differently in each environment appears here too.
- **Configured differently:** the resource exists in both, but settings differ, such as instance size or task count. Some differences are expected, such as a smaller Staging database.
- **Matching:** the compared settings are the same.

Only selected settings are compared, not everything about a resource. Networks are not compared, and ElastiCache is compared by replication group rather than by node.
