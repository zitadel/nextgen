# ADR 002: Multi-package Release Strategy

> **Status:** Accepted
> **Date:** 2026-04-25 (revised 2026-06-16)
> **Context:** nextgen monorepo release pipelines

## Decision

Release orchestration is split by responsibility:

1. **Moon owns the monorepo task graph and artifact builds.** CI, local checks,
   Go cross-builds, npm package packing, Docker Buildx image creation, and
   release verification run through `moon` targets.
2. **Changesets owns versions, changelogs, npm publishing, and package tags.**
   Public npm packages release independently. A private
   `@zitadel/server-release` package is Changesets-versioned and tagged so the
   Go server artifacts have a reviewed product version even though that package
   is not published to npm.
3. **Moon publishes non-npm product artifacts.** The server release target reads
   `@zitadel/server-release`, creates the product `vX.Y.Z` or
   `vX.Y.Z-alpha.N` tag, builds the Go archives, pushes
   `ghcr.io/zitadel/nextgen:<version>`, and updates one GitHub Release.

Nx and GoReleaser are retired dependencies. They are not part of the target CI
or release path.

## Context

This monorepo contains different release surfaces:

- A Go server binary distributed as archives and containers.
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
- Server versions are reviewed through the same version PR flow as npm package
  versions without pretending the server binary is an npm artifact.
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
- **Single lockstep train.** ADR 023 used this for public alpha simplicity, but
  it over-published unrelated surfaces and made recovery noisy.

## Follow-up

- Decide when to exit Changesets prerelease mode and publish stable `latest`
  npm packages.
- Add signing and provenance for server archives and containers.
- Decide whether `@zitadel/server` npm binary packages should be added as
  public Changesets-managed packages.
