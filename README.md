# PulseGrid

PulseGrid is a self-hosted dashboard for your environments, pipelines and cloud infrastructure. Each project keeps its own cloud accounts, Git connections and people, and you sign in with email and password or Google.

## Project layout

| Path | Purpose |
|---|---|
| `apps/api` | NestJS API and background sync worker |
| `apps/web` | Next.js web app |
| `packages/shared` | Types and rules used by both apps |
| `infra/terraform` | AWS infrastructure |

## Run it locally

You need Node 22, pnpm 9 and Docker.

```bash
cp .env.example .env
```

```bash
pnpm install
```

```bash
docker compose up -d --wait
```

```bash
pnpm db:migrate
```

Start the API, worker and web app:

```bash
pnpm dev
```

Open http://localhost:3000 and follow the setup wizard. The setup code is in the API log. See [docs/sign-in.md](docs/sign-in.md).

## Web design

The web app uses Tailwind CSS with components in `apps/web/src/components/ui`, built on Radix. Colors are defined as tokens in `apps/web/src/app/globals.css`, so a rebrand starts there.

To preview alongside a running dev server without sharing its build folder, set `NEXT_DIST_DIR` to another folder and use another port.

## Tests

The tests need Postgres and Redis from Docker Compose running.

```bash
pnpm test
```

## Tenant isolation

Tenant-owned tables use Postgres row-level security. The API connects as `devdash_app`, which is not the table owner, and sets the tenant for each transaction through `TenantDatabase`. Audit events can only be read and added, not changed or deleted.

## AWS inventory

Follow [docs/connect-aws-account.md](docs/connect-aws-account.md) to create a read-only access key, then add it under **Settings > Integrations > AWS**. Cloud support is built around providers, so other clouds can be added. See [docs/cloud-providers.md](docs/cloud-providers.md).

## System health

Overview shows the health of the selected account: problems, resource counts, work in progress, running pipelines and failures from the last 24 hours. It refreshes itself. If an account hasn't synced recently, it warns you rather than showing healthy. A stopped resource isn't a problem, because it may be off on purpose, and status comes from AWS, so it can't tell whether an application is responding.

## Environments

See [docs/environments.md](docs/environments.md).

## Pipelines

See [docs/pipelines.md](docs/pipelines.md).

## Service icons and logos

The icons in `apps/web/public/cloud-icons/aws` are AWS Architecture Icons, taken from the `aws-icons` package. AWS describes them for use in architecture diagrams. Check AWS's trademark guidelines before commercial release. To replace them, update those files and `ServiceIcon`.

The provider logos in `apps/web/public/cloud-icons/aws/logo.svg` and `apps/web/public/git-icons` belong to AWS and GitHub, and come from the `aws-icons` and `@primer/octicons` packages. They're used to show which service an integration connects to. Check each company's brand guidelines before commercial release.

## Deployment

Follow [docs/install-aws.md](docs/install-aws.md) to install on AWS, on new or existing infrastructure.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) to run the project and send changes, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for how we work together. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not as public issues.

## License

Licensed under the [Apache License 2.0](LICENSE).
