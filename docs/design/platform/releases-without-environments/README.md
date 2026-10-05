# Releases Without Environments

> **Status:** Spike — [#1389](https://github.com/zitadel/nextgen/issues/1389).
> Design only; nothing here is implemented.
>
> **Related:** [ADR 035](../../../adrs/035-configuration-environments.md)
> (releases and deployments),
> [ADR 036](../../../adrs/036-api-credential-planes.md) (credential planes, the
> publishable key),
> [ADR 062](../../../adrs/062-per-environment-variables-and-secrets.md)
> (variables), [security and origins](../../api/security-and-origins.md),
> [project secret](../secret.md),
> [configuration surface](../configuration-surface.md).

The server has no environments. Two things take their place:

- **Which server and project** a client talks to is resolved on the client, from
  the process environment and `.env` files. A stage is a `(server, project)`
  pair; the word `staging` never reaches the server.
- **Which release** is served is resolved per request, from the exact origin the
  request arrived on. A preview is an origin serving a release.

## Areas

| # | Area | Doc |
|---|---|---|
| 1 | **Project data model**: the entities, the origin inventory that replaces environments, the project class, the deployment log, and the variable store and its per-deployment snapshot | [`1-data-model.md`](1-data-model.md) |
| 2 | **Release resolution**: the three layers, what each kind of caller sends, worked request examples, and local development | [`2-release-resolution.md`](2-release-resolution.md) |
| 3 | **CLI: finding the server and project**: the resolution chain across flags, `process.env` and `.env` files | [`3-cli-target-resolution.md`](3-cli-target-resolution.md) |
| 4 | **CLI: commands**: `status`, `deploy`, `preview`, `origins`, `variables`, `rollback`, `dev`, `env` | [`4-cli-commands.md`](4-cli-commands.md) |
| 5 | **CLI: adding a project as a stage**: binding one repository to a second project, and what CI holds instead | [`5-cli-stages.md`](5-cli-stages.md) |

Each document carries its own Prerequisites and Open sections, covering what that
area needs that does not exist yet.
