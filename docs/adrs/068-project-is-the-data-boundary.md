# ADR 068: The Project Is the Data Boundary

> **Status:** Proposed
> **Date:** 2026-10-08
> **Context:** [#966](https://github.com/zitadel/nextgen/issues/966) (data
> isolation) and [#528](https://github.com/zitadel/nextgen/issues/528)
> (environments), answered by the spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389)
> ([PR #1427](https://github.com/zitadel/nextgen/pull/1427)). Supersedes the
> draft "Environment Lifecycle and Data Isolation"
> ([PR #1308](https://github.com/zitadel/nextgen/pull/1308)), whose
> data-isolation decision this ADR keeps and whose lifecycle decision no longer
> has a subject.
>
> **Builds on:** [ADR 035](035-configuration-environments.md) (releases,
> deployments), [ADR 036](036-api-credential-planes.md) (credential planes)

## Context

[ADR 035](035-configuration-environments.md) made an environment a runtime slot
on a project and left open whether a project's data is shared between its
environments, which environments a project has, and how a request finds its
environment. The spike behind [#1389](https://github.com/zitadel/nextgen/issues/1389)
removed the entity instead: a deployment targets origins, what an origin
serves is the newest deployment to it, and a request resolves its release from
the `Origin` it arrives with. With no environment on the server, two of the
three questions have no subject. The remaining one, where data is isolated, is
what this ADR records.

## Decision

The project is the data boundary. Users, sessions, tokens, credentials,
audit events, variables and every other runtime record belong to a project.
Nothing below the project partitions them. Two origins of one project, or a
preview URL and the project default, read and write the same user base, and a
session created while one origin served the request belongs to the project.

Only configuration differs by origin: each target serves the revisions
pinned by its newest deployment's release, as ADR 035 defines a release.

Isolated data is a second project. A staging whose users must not be
production's users, a sales demo that must not see customer records, a
customer's own tenant: each is a project, on the same server or another. A
release belongs to its project, so the same configuration reaches an isolated
project by being built there again from the same source. The content digest
([ADR 035](035-configuration-environments.md#release-bundle), idempotent on
content) is what lets a pipeline assert that two projects run the same thing.

No environment entity exists on the server. There is no `live`, no
`preview-<name>`, no seeded set, and no lifecycle. What a preview URL has is a
row admitting that exact URL for a limited time; what a primary hostname has is
a pattern on the project and its deployment history. The word "environment"
survives on the client, where it names a `(server, project)` pair a directory
is bound to, and the server never sees it.

## Consequences

- #966 is answered; #965's lifecycle questions are moot, and its two survivors,
  preview expiry and the origin patterns, are their own work.
- The `dev`, `staging`, `prod` trio seeded by #534, and the `live` plus
  previews taxonomy of PR #1308, are both withdrawn. The environment table,
  its endpoints and its event go.
- Authorization scopes are project scopes. ADR 054's deferred "environment
  security model" closes with nothing to define.
- A variable's owner is the project ([ADR 062](062-per-environment-variables-and-secrets.md)
  as amended): the one rule the environment scope carried, that a preview must
  not hold production secrets, becomes `applies_to` on the variable.
- Realistic data for testing a promoted release is production's data, on the
  production project, behind a preview URL, or a second project with its own
  data.
- The exception ADR 035 notes, that a user record carries the user-schema
  revision it was created against, is unchanged and is per project like the
  user.
