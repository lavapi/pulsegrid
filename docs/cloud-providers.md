# Add a cloud provider

The dashboard isn't tied to one cloud. Accounts, credentials, sync, sync progress, the map and pages all work through a provider, and AWS is the first one. GCP and Azure aren't built yet.

To add a provider:

1. **Describe it** in `packages/shared/src/providers/<provider>.ts`, and add it to `CLOUD_PROVIDERS` in `packages/shared/src/cloud-providers.ts`. This sets its name, icon, credential fields, regions and setup instructions. The Integrations pages are built from this, so a new provider needs no new forms.
2. **Add its resources** to `RESOURCE_TYPES`, `SERVICE_CATEGORIES` and `CLOUD_SERVICES` in `packages/shared/src/inventory.ts`. Add table columns in `apps/web/src/lib/service-views.ts`.
3. **Add its icons** to `apps/web/public/cloud-icons/<provider>/`, with one file for each category.
4. **Build the provider** in `apps/api/src/inventory/providers/<provider>/`, implementing `CloudProvider` from `providers/provider.ts`:

| Part | What it does |
|---|---|
| `parseCredentials` | Validates what an admin entered |
| `credentialHint` | Gives a masked value that's safe to show |
| `isValidRegion` | Checks a region |
| `checkCredentials` | Tests credentials with the cloud, and returns the account ID and what can be read. Throw `CredentialsRejected` with a friendly message if they're refused |
| `collectors` | Read resources for sync |
| `costSource` | Optional. Reads costs by service and month, and explains a failed read |
| `failureMessage` | Explains a failed read in plain language |
| `buildMap` | Turns resources into the groups, nodes and connections on the map |

5. **Register it** in `CLOUD_PROVIDER_LIST` in `apps/api/src/inventory/inventory-core.module.ts`.

Keep cloud-specific code inside the provider's folder. Credentials are encrypted and stored by the app, so a provider never handles storage. `apps/api/test/cloud-providers.test.ts` shows a small provider running through the whole app.
