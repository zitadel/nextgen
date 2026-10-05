# Releases Without Environments

> **Status:** Spike — [#1389](https://github.com/zitadel/nextgen/issues/1389).
> Design only; nothing here is implemented.
>
> **Related:** [ADR 035](../../../adrs/035-configuration-environments.md)
> (releases and deployments),
> [ADR 036](../../../adrs/036-api-credential-planes.md) (credential planes, the
> publishable key),
> [ADR 062](../../../adrs/062-per-environment-variables-and-secrets.md)
> (variables and secrets),
> [security and origins](../../api/security-and-origins.md),
> [project secret](../secret.md),
> [configuration surface](../configuration-surface.md).

The server has no environment *entity*. The word survives, on the client, where
everything that feeds it already lives; what goes away is the resource — the
`env_` id, the name index, the current-deployment pointer and the variable
scope. Two things take its place:

- **Which server and project** a client talks to is resolved on the client, from
  the process environment and `.env` files. An environment is a `(server,
  project)` pair held on the client — the name selects files and never reaches
  the server, and no server resource is keyed on it.
- **Which release** is served is resolved per request, from the exact origin the
  request arrived on. A preview is an origin serving a release.

## Areas

| # | Area | Doc |
|---|---|---|
| 1 | **Data model**: the entities, and the append-only deployment log that replaces the environment pointer | [`1-data-model.md`](1-data-model.md) |
| 2 | **Origins**: the allowlist of patterns, the inventory of live URLs, the tenant-anchor rule and the project class | [`2-origins.md`](2-origins.md) |
| 3 | **Variables and secrets**: the store a person edits, the immutable snapshot a deployment runs, and how a preview gets different values | [`3-variables.md`](3-variables.md) |
| 4 | **Release resolution**: the three layers, what each kind of caller sends, worked request examples, and local development | [`4-release-resolution.md`](4-release-resolution.md) |
| 5 | **CLI: finding the server and project**: the resolution chain across flags, `process.env` and `.env` files | [`5-cli-target-resolution.md`](5-cli-target-resolution.md) |
| 6 | **CLI: commands**: `status`, `deploy`, `preview`, `origins`, `allowlist`, `vars`, `rollback`, `dev`, `env` | [`6-cli-commands.md`](6-cli-commands.md) |
| 7 | **CLI: adding a project as an environment**: binding one repository to a second project, and what CI holds instead | [`7-cli-environments.md`](7-cli-environments.md) |

Each document carries its own Prerequisites and Open sections, covering what that
area needs that does not exist yet.
