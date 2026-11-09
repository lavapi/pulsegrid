# Security policy

This dashboard stores cloud access keys and Git tokens, so we take reports seriously.

## Reporting a vulnerability

Please don't open a public issue. Use **Report a vulnerability** on the repository's **Security** tab, which sends a private report to the maintainers.

Include what you found, the steps to reproduce it, the version or commit, and the impact you expect. We'll confirm we've received it within 3 working days, keep you updated while we fix it, and credit you in the release notes unless you'd rather we didn't.

## Supported versions

Fixes go into the latest release. Update to the newest version before reporting, in case the problem is already fixed.

## What's in scope

- Signing in, sessions, two-factor authentication and temporary passwords.
- Access between projects: someone reaching a project, its data or its Activity without being a member.
- Roles and permissions, including production staying read-only.
- Stored secrets: cloud access keys, Git tokens and two-factor secrets, and anything that could expose them.
- The API, the web app, the Docker images and the Terraform modules in this repository.

Problems in your own AWS account, GitHub organization or hosting are out of scope, as are reports that need someone who already has full access to the server or database.

## Running it safely

- Run it behind HTTPS, and keep `TOKEN_ENCRYPTION_KEY` secret and backed up.
- Give cloud access keys the read-only policy from **Integrations** wherever you can, and the extended policy only for non-production accounts.
- Keep the database and Redis off the public internet.
