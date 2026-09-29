# ADR 066: Environment Lifecycle and Data Isolation

> **Status:** Proposed
> **Date:** 2026-09-25
> **Context:** [#965](https://github.com/zitadel/nextgen/issues/965) (lifecycle
> and classes), [#966](https://github.com/zitadel/nextgen/issues/966) (data
> isolation), prototype
> [PR #1258](https://github.com/zitadel/nextgen/pull/1258)
>
> **Builds on:** [ADR 035](035-configuration-environments.md) (environments,
> releases, deployments)

## Context

[ADR 035](035-configuration-environments.md) made environments runtime slots on
a project and left two questions open: whether a project's data is isolated
between its environments, and which environments a project has over its
lifetime. The preview-environments prototype
([PR #1258](https://github.com/zitadel/nextgen/pull/1258)) answered both. This
ADR records the answers so the remaining milestone work has one place to cite.

The API and CLI will be able to maintain different projects on different
servers and deploy configuration to each of them; every project keeps its own
isolated data. The exact CLI commands to manage these projects and
environments are out of scope for this ADR.

## Decision

### Data isolation

There is no runtime data isolation between the environments of a project.
Users, sessions, and tokens are project-scoped. Every environment of a project
reads and writes the same user base, and a session or token created while one
environment served the request belongs to the project.

Only configuration resources differ per environment: each environment serves
the revisions pinned by its currently deployed release, as
[ADR 035](035-configuration-environments.md) defines.

A tenant that needs isolated data, such as a staging user base that must not
see production users, uses a separate project. The project is the data
boundary, and a release belongs to its project, so shipping the same
configuration into an isolated project means building it there again from the
same source.

### Lifecycle

Every project has exactly one `live` environment. It exists from project
creation, cannot be deleted, and serves the releases the project's real traffic
runs on. Deploy, promote, and rollback against `live` reach production.

All other environments are preview environments: ephemeral, created on demand
as `preview-<name>`, carrying an expiry that is renewed on deploy and enforced
by garbage collection. They exist to try a release before it reaches `live`,
and differ from `live` only in the release they serve.

#### Creation

`live` is created with the project and never by hand. Preview environments
are created on demand: `zitadel preview` deploys a release to a preview by
name (`POST /environments` on the wire), creating the environment if the name
does not exist yet and renewing its expiry if it does, so a preview's URL
stays stable across redeploys.

#### Deletion

A preview is deleted when its expiry passes and the garbage collector picks it up, or
earlier by hand (`zitadel env delete`, `DELETE /environments/{name}`).
Deletion removes the environment record together with its deployment history;
the releases it served belong to the project and are untouched. A collected
name may be reused, and the reuse is a new environment with a new identity,
not a revival of the old one.

There are no other environment kinds. The draft taxonomy of long-lived dev,
staging and prod peers per project
([PR #1211](https://github.com/zitadel/nextgen/pull/1211)) is rejected.

An app's own development, staging and production deployments each bind to a
different project, and nothing requires those projects to share a server: the
CLI holds the mapping in `zitadel.json`, one server-and-project pair per app
environment, so development may run against a local instance while production
runs against the cloud. Each project again has its `live` and previews; the
server itself knows no environment kinds and never sees the app's mapping.

Projects and environments topology:
<img width="3424" height="1968" alt="Projects and environments topology" src="https://github.com/user-attachments/assets/f9e4c68e-e719-448d-907b-9a119b0ca083" />

## Consequences

- The dev/staging/prod trio generated at project creation is replaced by `live`
  alone.
- Whether a preview falls back to the `live` values of
  [ADR 062](062-per-environment-variables-and-secrets.md) variables when it
  sets none is a follow-up.
- Preview expiry needs a garbage collector.
- The CLI documents rebuild-from-source as the way configuration moves between
  projects.
