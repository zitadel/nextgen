# ADR 002: Multi-package Release Strategy

> **Status:** Proposed
> **Date:** 2026-04-25
> **Context:** nextgen monorepo release pipelines

## Decision

Release the three artifact families produced by this monorepo with two complementary tools, on independent cadences:

1. **Go server binary + embedded React console**: released by `goreleaser` from explicit `v*` server tags. The release produces multi-arch archives (linux/darwin/windows × amd64/arm64, minus windows/arm64), per-arch Docker images, and a `ghcr.io/zitadel/nextgen` manifest list. The console SPA is built by Vite during goreleaser's `before.hooks`, copied into the Go embed package, and embedded into the binary via `//go:embed` behind the `embed_console` build tag. Manual `workflow_dispatch` remains available for non-publishing snapshots.
2. **TypeScript packages** (`apps/cli/`, `packages/api`, `packages/components`, `packages/design-tokens`, `packages/shared-component-styles`, `packages/ui-react`, `packages/sdk-*/`): released by `changesets`. Each PR adds a `.changeset/*.md` describing the bump. The `npm-release` workflow opens a "Version Packages" PR aggregating pending changes; merging it tags per-package versions and publishes changed packages to npm under the `next` dist-tag when `NPM_TOKEN` is configured.
3. **The console SPA is intentionally not a separately versioned npm package.** It is the Go server's UI; it ships embedded in the server binary at the server's version. If a future use case calls for a standalone console library, it becomes a new entry under `packages/` managed by changesets, and the Go server pins a specific version.

Cross-package coordination is handled via changeset notes and peer-dep ranges, not unified tags.

## Context

This monorepo contains three meaningfully different release surfaces:

- A Go server binary distributed as containers and tarballs to operators.
- A TypeScript developer CLI (`apps/cli/`) consumed via `npx zitadel`.
- A web components library and TypeScript SDKs (`packages/...`) consumed by application developers.

Each surface has different consumers, different cadences, and different distribution channels. Forcing them onto a single release tool either compromises one (changesets is npm-focused; goreleaser is Go-focused) or invents a custom orchestration layer that no contributor will recognize.

The console SPA sits between these: it is built and published as part of the Go server, never as its own npm package. This commitment is non-obvious enough to warrant explicit documentation.

## Consequences

Positive:

- Each tool is used for its strength. `goreleaser` is the de facto standard for Go binary + multi-arch Docker releases. `changesets` is what most pnpm-workspace projects (Astro, Remix, Vercel SDKs) converge on.
- Release cadences stay independent. A bug fix in `@zitadel/cli` does not require a server release; a server patch does not bump CLI versions.
- New contributors recognize both workflows from prior projects.
- The `.changeset/*.md` files in PRs make user-visible changes self-documenting before release and feed the automated Version Packages PR.

Trade-offs:

- Two release tools to learn. New maintainers need to know both `goreleaser` (for the server) and `changesets` (for npm).
- Cross-package version coupling is manual: when a CLI release requires a specific server version, the changeset note records it and the CLI's `package.json` peer-dep range encodes it.
- The console SPA cannot be consumed standalone without re-architecting it as a `packages/console-ui` library. We accept this trade for now because the SPA is tightly coupled to the server's API and capability handshake.

## Alternatives considered

- **`release-please` (Google).** Handles Go and npm in a single tool using conventional commits. Heavier, less idiomatic for pnpm workspaces, and changesets' explicit `.changeset/*.md` files give clearer per-PR signal than commit-message scraping.
- **`nx release`.** Native to the Nx workspace already in use. npm-focused; would still need a Go-side companion. Adds one more vendor-specific tool without removing `goreleaser`.
- **Custom workflows with tag-pattern matchers** (e.g. `cli-v*`, `components-v*`, `v*`). Maximum flexibility but reinvents what changesets and goreleaser already do well, and pushes maintenance burden onto the team.
- **Single all-in-one tag.** A `v1.2.3` tag releasing server + CLI + components together. Couples cadences artificially: every CLI patch becomes a server release.

## Open questions

- Whether to put `@zitadel/sdk-core` and `@zitadel/sdk-next` into a `linked` group in `.changeset/config.json` once the SDK packages mature and want lockstep versioning.
- When to layer image signing (`cosign`) and SLSA provenance attestations onto the goreleaser pipeline. Out of scope for the initial setup, but the `release.yml` workflow already requests `id-token: write` so the keyless flow is available when needed.
- Whether to publish the console SPA as a documentation/preview artifact (e.g., to a CDN bucket) for design reviews, separate from the embedded Go server release.

## Follow-up

- Claim the `@zitadel` npm scope and configure npm publishing credentials (org admin preconditions for changesets to publish).
- Decide when to switch npm publishing from the `next` dist-tag to `latest`.
- Draft a `CONTRIBUTING.md` section pointing contributors at `pnpm changeset` for npm changes and conventional commit prefixes for the goreleaser changelog.
- Decide ADR 003 territory: should server config schemas or other stable contracts have their own release/versioning policy that crosses both tools?
