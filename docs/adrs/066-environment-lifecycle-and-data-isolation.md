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

## Decision

### Data isolation

There is no runtime data isolation between the environments of a project.
Users, sessions, and tokens are project-scoped. Every environment of a project
reads and writes the same user base, and a session or token created while one
environment served the request belongs to the project.

Only configuration resources differ per environment: each environment serves
the revisions pinned by its currently deployed release, as
[ADR 035](035-configuration-environments.md) defines. An environment changes
which configuration a request sees, and nothing about which data it reaches.

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
does not exist yet and renewing its expiry if it does. Deploying to the same
name again is an update of the same environment, which is what keeps a
preview's URL stable across redeploys.

#### Deletion

`live` cannot be deleted; it goes away only with its project. A preview is
deleted when its expiry passes and the garbage collector picks it up, or
earlier by hand (`zitadel env delete`, `DELETE /environments/{name}`).
Deletion removes the environment record together with its deployment history;
the releases it served belong to the project and are untouched. A collected
name may be reused, and the reuse is a new environment with a new identity,
not a revival of the old one.

There are no other environment kinds. The earlier draft taxonomy of arbitrary
long-lived environments per project, with dev, staging and prod as peers (the
discarded lifecycle draft in
[PR #1211](https://github.com/zitadel/nextgen/pull/1211)), is rejected. What
those environments isolated was data, and data isolation belongs to the
project.

This is the definition of an environment from the server's and the project's
point of view. A frontend application is free to keep its own notion of
environments: an app's development, staging and production deployments can
each bind to a different project, and each of those projects again has its
`live` environment and previews. The app-level environment split is expressed
through projects, not through environment kinds the server would have to know
about.

Projects and environments topology:
<img width="3424" height="1968" alt="Zitadel NextGen (13)" src="https://github.com/user-attachments/assets/f9e4c68e-e719-448d-907b-9a119b0ca083" />



## Consequences

- The dev/staging/prod trio generated at project creation is replaced by `live`
  alone.
- Environment-scoped variables
  ([ADR 062](062-per-environment-variables-and-secrets.md)) distinguish `live`
  from previews. Where a preview supplies no value of its own, whether
  resolution falls back to the values entered for `live` is a follow-up
  decision, outside this ADR.
- Preview expiry needs a garbage collector. Deleting an expired environment
  never deletes the releases it served.
- Cross-project promotion is impossible by construction and intended to stay
  that way. The CLI documents rebuild-from-source as the way configuration
  moves between isolated projects.
