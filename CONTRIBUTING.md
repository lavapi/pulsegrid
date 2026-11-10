# Contributing

Thanks for helping. This guide covers how to run the project, what we expect in a pull request, and the rules that keep projects and secrets safe.

## Run it locally

You need Node 22, pnpm 9 and Docker. Follow **Try it locally** in the [README](README.md), then open http://localhost:3000 and finish the setup wizard. Run `pnpm db:demo` afterwards if you want made-up accounts and resources to work with.

## Project layout

| Path | Purpose |
|---|---|
| `apps/api` | NestJS API and background sync worker |
| `apps/web` | Next.js web app |
| `packages/shared` | Types and rules used by both apps |
| `infra/terraform` | AWS infrastructure |

The web app uses Tailwind CSS with components in `apps/web/src/components/ui`, built on Radix. Colors are defined as tokens in `apps/web/src/app/globals.css`, so a rebrand starts there. To run a second copy of the web app beside a running dev server, set `NEXT_DIST_DIR` to another folder and use another port.

The AWS icons in `apps/web/public/cloud-icons/aws` come from the `aws-icons` package, and the provider logos in `apps/web/public/git-icons` from `@primer/octicons`. To replace the service icons, update those files and `ServiceIcon`.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Branch from `develop`, and open your pull request against `develop`. `main` only receives releases.

## Pull requests

- Keep each pull request to one change, with a clear title and a short description of what changed and why.
- Run the checks first. They need Postgres and Redis from Docker Compose running.

```bash
pnpm typecheck
```

```bash
pnpm test
```

- Add or update tests for the behaviour you change.
- Update the docs in `docs/` when behaviour changes, and add a line under **Unreleased** in `CHANGELOG.md` and `RELEASE_NOTES.md`.
- Use Conventional Commits, such as `feat:`, `fix:`, `docs:`, `refactor:` or `test:`.

## How we write code

- Small, focused functions and classes with clear names. Don't repeat logic; share it.
- Every message a person sees must be readable. Never show raw error codes or exceptions, and ignore cancelled actions silently.
- Keep it provider-neutral where you can: cloud and Git providers live behind interfaces in `apps/api/src/inventory/providers` and `apps/api/src/pipelines/git`. See [docs/cloud-providers.md](docs/cloud-providers.md) and [docs/git-providers.md](docs/git-providers.md).

## Rules that protect people's data

- **Projects stay apart.** Every table that belongs to a project has a `tenant_id` and Postgres row-level security. The API connects as `devdash_app`, which doesn't own the tables, and sets the project for each transaction. Read and write through `TenantDatabase.run`, and never give someone access to a project without a membership. Audit events can only be read and added, never changed or deleted.
- **Migrations run as a normal database user.** In production the migration user can't bypass row-level security, so a migration that changes rows across projects must turn off `force row level security` on those tables while it runs and turn it back on at the end. Test it as a role without superuser rights, as `apps/api/test/people-pool-migration.test.ts` does.
- **Production is read-only.** Don't add actions that change production resources.
- **Never store, log or return secret values** beyond what's already designed, and never log access keys or tokens.
- **No real customer data** in code, tests, docs or examples. Use `example.com` and made-up names and account numbers.

## Reporting security problems

Please don't open a public issue. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
