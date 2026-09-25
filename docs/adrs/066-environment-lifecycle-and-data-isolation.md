# ADR 066: Environment Lifecycle and Data Isolation

> **Status:** Proposed
> **Date:** 2026-09-25
> **Context:** #965 (lifecycle and classes), #966 (data isolation), prototype PR
> #1258
> **Builds on:** [ADR 035](035-configuration-environments.md) (environments,
> releases, deployments)

## Context

ADR 035 made environments runtime slots on a project and left two questions
open: whether a project's data is isolated between its environments, and which
environments a project has over its lifetime. The preview-environments
prototype (PR #1258) answered both. This ADR records the answers so the
remaining milestone work has one place to cite.

## Decision

### Data isolation

There is no runtime data isolation between the environments of a project.
Users, sessions, and tokens are project-scoped. Every environment of a project
reads and writes the same user base, and a session or token minted while one
environment served the request belongs to the project.

Only configuration resources differ per environment: each environment serves
the revisions pinned by its currently deployed release, as ADR 035 defines. An
environment changes which configuration a request sees, and nothing about which
data it reaches.

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

There are no other environment kinds. The earlier draft taxonomy of arbitrary
long-lived environments per project, with dev, staging and prod as peers (the
discarded lifecycle draft in PR #1211), is rejected. What those environments
isolated was data, and data isolation belongs to the project.

## Consequences

- The dev/staging/prod trio minted at project creation is replaced by `live`
  alone.
- Environment-scoped variables (ADR 062) distinguish `live` from previews.
  Where a preview supplies no value of its own, whether resolution falls back
  to the values entered for `live` is a follow-up decision, outside this ADR.
- Preview expiry needs a garbage collector. Deleting an expired environment
  never deletes the releases it served.
- Cross-project promotion is impossible by construction and intended to stay
  that way. The CLI documents rebuild-from-source as the way configuration
  moves between isolated projects.
