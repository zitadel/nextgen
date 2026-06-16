# ADR 023: Lockstep Alpha Release Train

> **Status:** Superseded by [ADR 002](002-multi-package-release-strategy.md)
> **Date:** 2026-06-11
> **Superseded:** 2026-06-16
> **Context:** customer-facing alpha releases for nextgen

## Decision

This decision is superseded. The repository no longer uses a lockstep alpha
train across npm packages, CLI, server image, and GoReleaser artifacts.

The current release strategy is:

- Moon owns CI task execution and non-npm artifact builds.
- Changesets owns versions, changelogs, npm publishing, and package tags.
- Public npm packages release independently.
- A private `@zitadel/server-release` package records the product/server
  version that Moon uses for Go archives, containers, product tags, and GitHub
  Releases.

## Historical context

The lockstep alpha train intentionally traded independent package releases for
a simple tester-facing version during early public alpha. It also required
special recovery machinery, GoReleaser tag filtering, npm train validation, and
manual latest dist-tag handling. The Moon + Changesets model removes that train
state and keeps release review in Changesets version PRs.
