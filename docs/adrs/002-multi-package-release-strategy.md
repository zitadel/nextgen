# ADR 002: Multi-package Release Strategy

> **Status:** Accepted
> **Date:** 2026-04-25 (revised 2026-06-16)
> **Context:** nextgen monorepo release pipelines

## Decision

Release orchestration is split by responsibility:

1. **Moon owns the monorepo task graph and artifact builds.** CI, local checks,
   Go cross-builds, npm package packing, Docker Buildx image creation, and
   release verification run through `moon` targets.
2. **Changesets owns versions, changelogs, npm publishing, and public package
   tags.** The public product packages release as one fixed group while the
   repo is in alpha: CLI, server npm runtime, server platform binaries, API,
   components, and SDK packages share one version.
3. **Moon publishes non-npm product artifacts and the product announcement.**
   The server release target reads `@zitadel/server`, stages the Go binaries
   into the platform npm packages, creates the product `vX.Y.Z` or
   `vX.Y.Z-alpha.N` tag, builds the Go archives, pushes
   `ghcr.io/zitadel/nextgen:<version>`, and updates one GitHub Release.

Nx and GoReleaser are retired dependencies. They are not part of the target CI
or release path.

## Context

This monorepo contains different release surfaces:

- A Go server binary distributed as npm platform packages, archives, and
  containers.
- A TypeScript developer CLI, published as `@zitadel/cli`.
- Web components and framework SDK packages consumed from npm.

The old model used Nx for TypeScript task inference, Changesets for npm
packages, and GoReleaser for Go/server artifacts. ADR 023 then added a lockstep
alpha train across those tools. That reduced tester confusion temporarily, but
it also created a complex recovery path and left maintainers debugging release
state across multiple release systems.

The new model keeps the explicit per-PR release notes from Changesets, but
makes Moon the single task graph for both Go and TypeScript work.

## Consequences

Positive:

- Contributors and CI use one build front door: `moon`.
- Changesets remains the recognizable npm versioning and publishing workflow.
- Server binary npm packages, CLI, and SDKs move through one reviewed
  Changesets fixed release during alpha.
- Product releases have one human-facing Git tag and GitHub Release, owned by
  Moon release tasks rather than Changesets package tags.
- Release recovery becomes idempotent artifact verification and republishing,
  not a separate alpha train state machine.

Trade-offs:

- The repo owns the Go archive, checksum, container, and GitHub Release glue
  previously provided by GoReleaser.
- Moon task definitions must be maintained explicitly instead of relying on Nx
  plugin inference.
- GitHub workflow aggregation must account for split CI workflows.

## Alternatives considered

- **GoReleaser + Changesets.** Proven tools individually, but the mixed release
  brain produced tag filtering, train recovery, and half-published state.
- **Nx Release.** Strong in JavaScript workspaces, but still needed custom Go
  artifact publishing and kept the repo in an Nx-centered model.
- **Changesets only.** Good for npm publishing, but Changesets does not build
  multi-platform Go binaries or containers; Moon is the artifact executor.
- **Single lockstep train across multiple release tools.** ADR 023 used this
  for public alpha simplicity, but it over-published through separate release
  systems and made recovery noisy. The fixed Changesets group keeps the single
  version while using one npm publisher.

## Follow-up

- Decide when to exit Changesets prerelease mode and publish stable `latest`
  npm packages.
- Add signing and provenance for server archives and containers.
- Decide when the fixed alpha group can split into independent package releases.
