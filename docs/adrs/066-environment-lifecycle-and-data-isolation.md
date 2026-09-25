# ADR 066: Environment Lifecycle and Data Isolation

> **Status:** Proposed
> **Date:** 2026-09-25
> **Context:** #965 (lifecycle and classes), #966 (data isolation), prototype PR #1258
> **Builds on:** [ADR 035](035-environment-releases-for-configuration-resources.md) (environments, releases, deployments)

## The need

ADR 035 introduced environments as runtime slots on a project but left two
questions open: whether the data a project holds is isolated between its
environments, and which environments a project has over its lifetime. Both
were answered by the preview-environments prototype (PR #1258) and are
recorded here so the remaining milestone work can quote one decision instead
of re-deriving it.

## Decision

### Data isolation

There is no runtime data isolation between the environments of a project.
Users, sessions, and tokens are project-scoped: every environment of a
project reads and writes the same user base, and a session or token minted
while one environment served the request is a session or token of the
project.

Only configuration resources differ per environment — each environment
serves the revisions pinned by its currently deployed release, exactly as
ADR 035 defines. An environment is a configuration lens over shared project
data, not a data partition.

A tenant that needs isolated data — a staging user base that must not see
production users — uses a separate project. The project is the data
boundary, and releases do not cross it: a release belongs to its project,
so shipping the same configuration to an isolated project means building it
there again from the same source.

### Lifecycle

Every project has exactly one **`live`** environment. It exists from
project creation, cannot be deleted, and serves the releases the project's
real traffic runs on. Deploy, promote, and rollback against `live` are the
production verbs.

All other environments are **preview** environments: ephemeral, created on
demand (`preview-<name>`), carrying an expiry that is renewed on deploy and
enforced by garbage collection. They exist to try a release before it
reaches `live` and differ from it only in the release they serve.

There are no other environment kinds. The earlier draft taxonomy of
arbitrary long-lived environments per project (dev, staging, prod as
peers — the discarded ADR 061 lifecycle draft, PR #1211) is rejected: what
those environments isolated was data, and data isolation is the project's
job.

## Consequences

- The dev/staging/prod trio minted at project creation is replaced by
  `live` alone.
- Environment-scoped variables (ADR 062) distinguish `live` from previews;
  where a preview supplies no value of its own, resolution against the
  values entered for `live` is a follow-up decision, not part of this ADR.
- Preview expiry needs a garbage collector; deleting an expired environment
  never deletes the releases it served.
- Cross-project promotion is structurally impossible and intentionally so;
  the CLI documents rebuild-from-source as the way configuration moves
  between isolated projects.
