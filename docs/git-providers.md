# Add a Git provider

Pipelines work through a Git provider, and GitHub is the first one. GitLab and Bitbucket aren't built yet.

To add a provider:

1. **Describe it** in `packages/shared/src/providers/<provider>.ts`, and add it to `GIT_PROVIDERS` in `packages/shared/src/git-providers.ts`. This sets its name, icon, credential fields, setup instructions and whether it can re-run only failed jobs. The Integrations page is built from this, so a new provider needs no new form.
2. **Build the provider** in `apps/api/src/pipelines/git/<provider>/`:

| Part | What it does |
|---|---|
| `parseCredentials` | Validates what an admin entered |
| `credentialHint` | Gives a masked value that's safe to show |
| `connect` | Returns a `GitClient` for those credentials |

3. **Implement `GitClient`** from `git/git-provider.ts`. It lists repositories, pipelines, runs, jobs and branches, and starts, re-runs and cancels runs. `readDefinition` turns the provider's pipeline file into a `PipelineDefinition`, including any branch-based environment rule. Throw `GitProviderError` with a friendly message when something fails.
4. **Register it** in `GIT_PROVIDER_LIST` in `apps/api/src/pipelines/pipelines.module.ts`.

Keep provider-specific code in its folder. Tokens are encrypted and stored by the app, and cached data is kept per connection, so a provider handles neither. `apps/api/test/git-connections.test.ts` shows a small provider running through the app.
