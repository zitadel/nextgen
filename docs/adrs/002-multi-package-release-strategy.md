# ADR 002: Multi-package Release Strategy

> **Status:** Accepted
> **Date:** 2026-04-25 (accepted 2026-06-03)
> **Context:** nextgen monorepo release pipelines

## Decision

Release the three artifact families produced by this monorepo with two complementary tools. Component releases can use independent cadences, while the public alpha train temporarily uses one lockstep version as defined in [ADR 023](023-lockstep-alpha-release-train.md):

1. **Go server binary + embedded React console**: released by `goreleaser` against an explicit release tag. While this repository is pre-release, the publish-capable workflow is normally driven by the alpha train's `release-npm` job in [`ci.yml`](../../.github/workflows/ci.yml); the manual [`release.yml`](../../.github/workflows/release.yml) workflow remains available for snapshots and fallback server releases. The release produces multi-arch archives (linux/darwin/windows × amd64/arm64, minus windows/arm64), per-arch Docker images, and a `ghcr.io/zitadel/nextgen` manifest list. The console SPA is built by Vite during goreleaser's `before.hooks` and embedded into the binary via `//go:embed`. GoReleaser jobs prune Changesets-created npm package tags (`@zitadel/*`) from the local checkout before running so scoped package tags are never interpreted as server release tags.
2. **TypeScript packages**: released by `changesets` via the `release-npm` job in [`ci.yml`](../../.github/workflows/ci.yml). The public packages are `@zitadel/cli` (`apps/cli/`), `@zitadel/api`, `@zitadel/components`, `@zitadel/sdk-core`, `@zitadel/sdk-next`, `@zitadel/sdk-nuxt`, `@zitadel/sdk-react`, `@zitadel/sdk-vue`, and `@zitadel/sdk-angular`. Every other workspace package is marked `"private": true` and never publishes. Each PR adds a `.changeset/*.md` describing the bump; pushing changesets to `main` opens a "Version Packages" PR aggregating pending changes, and merging that PR waits for the matching main CI aggregate gate before versioned packages publish to npm. Authentication uses **npm trusted publishing (OIDC)** — there is no `NPM_TOKEN`. npm provenance is disabled while the repository is private because npm only accepts provenance attestations from public source repositories; re-enable it when `zitadel/nextgen` is public. The repo is in changesets **prerelease mode** (`.changeset/pre.json`, tag `alpha`): versions are cut as `X.Y.Z-alpha.N` and published under the `alpha` dist-tag until `changeset pre exit` cuts a stable `latest` release.
3. **The console SPA is intentionally not a separately versioned npm package.** It is the Go server's UI; it ships embedded in the server binary at the server's version. If a future use case calls for a standalone console library, it becomes a new entry under `packages/` managed by changesets, and the Go server pins a specific version.

Cross-package coordination is handled via changeset notes and peer-dep ranges
outside the public alpha train. ADR 023 defines the temporary lockstep `alpha`
policy for tester-facing releases.

## Context

This monorepo contains three meaningfully different release surfaces:

- A Go server binary distributed as containers and tarballs to operators.
- A TypeScript developer CLI (`apps/cli/`), published as `@zitadel/cli` (binary name `zitadel`).
- A web components library and TypeScript SDKs (`packages/...`) consumed by application developers.

Each surface has different consumers, different cadences, and different distribution channels. Forcing them onto a single release tool either compromises one (changesets is npm-focused; goreleaser is Go-focused) or invents a custom orchestration layer that no contributor will recognize.

The console SPA sits between these: it is built and published as part of the Go server, never as its own npm package. This commitment is non-obvious enough to warrant explicit documentation.

## Consequences

Positive:

- Each tool is used for its strength. `goreleaser` is the de facto standard for Go binary + multi-arch Docker releases. `changesets` is what most pnpm-workspace projects (Astro, Remix, Vercel SDKs) converge on.
- Release cadences can return to independence after the public alpha period.
  During alpha, ADR 023 intentionally trades that independence for a simpler
  tester release train.
- New contributors recognize both workflows from prior projects.
- The `.changeset/*.md` files in PRs make user-visible changes self-documenting before release, even before npm publishing automation is enabled.

Trade-offs:

- Two release tools to learn. New maintainers need to know both `goreleaser` (for the server) and `changesets` (for npm).
- Cross-package version coupling is manual: when a CLI release requires a specific server version, the changeset note records it and the CLI's `package.json` peer-dep range encodes it.
- The console SPA cannot be consumed standalone without re-architecting it as a `packages/console-ui` library. We accept this trade for now because the SPA is tightly coupled to the server's API and capability handshake.

## Alternatives considered

- **`release-please` (Google).** Handles Go and npm in a single tool using conventional commits. Heavier, less idiomatic for pnpm workspaces, and changesets' explicit `.changeset/*.md` files give clearer per-PR signal than commit-message scraping.
- **`nx release`.** Native to the Nx workspace already in use. npm-focused; would still need a Go-side companion. Adds one more vendor-specific tool without removing `goreleaser`.
- **Custom workflows with tag-pattern matchers** (e.g. `cli-v*`, `components-v*`, `v*`). Maximum flexibility but reinvents what changesets and goreleaser already do well, and pushes maintenance burden onto the team.
- **Single all-in-one tag.** A `v1.2.3` tag releasing server + CLI + components together. ADR 023 adopts this only for the public alpha train, where the lower tester mental overhead is worth the temporary coupling.

## Open questions

- When to leave the temporary public alpha fixed group and return to independent
  component releases.
- When to layer image signing (`cosign`) and SLSA provenance attestations onto the goreleaser pipeline. Out of scope for the initial setup, but the `release.yml` workflow already requests `id-token: write` so the keyless flow is available when needed. npm provenance for the TypeScript packages should be re-enabled once the source repository is public.
- Whether to publish the console SPA as a documentation/preview artifact (e.g., to a CDN bucket) for design reviews, separate from the embedded Go server release.
- When to run `changeset pre exit` to leave the `alpha` prerelease line and cut the first stable `latest` release.

## Follow-up

- ✅ The `@zitadel` npm scope is owned (the main `zitadel` repo already publishes `@zitadel/client` and `@zitadel/proto` under it).
- ✅ The changesets publishing job (`release-npm` in [`ci.yml`](../../.github/workflows/ci.yml)) is enabled, using npm trusted publishing (OIDC) — no `NPM_TOKEN` secret. Provenance is disabled while this source repository is private.
- One-time bootstrap per public package: a maintainer must do the first manual publish (the names do not exist on npm yet) and then add the GitHub Actions trusted publisher on npmjs.com (repo `zitadel/nextgen`, workflow `ci.yml`). See [`.changeset/README.md`](../../.changeset/README.md).
- Decide when to switch the Go release workflow from the alpha train/manual
  fallback to automatic stable `v*` tag releases.
- Draft a `CONTRIBUTING.md` section pointing contributors at `pnpm changeset` for npm changes and conventional commit prefixes for the goreleaser changelog.
- Decide ADR 003 territory: should server config schemas or other stable contracts have their own release/versioning policy that crosses both tools?
