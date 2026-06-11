# ADR 002: Multi-package Release Strategy

> **Status:** Accepted
> **Date:** 2026-04-25 (accepted 2026-06-03)
> **Context:** nextgen monorepo release pipelines

## Decision

Release the three artifact families produced by this monorepo with two complementary tools, on independent cadences:

1. **Go server binary + embedded React console**: released by `goreleaser` against an explicit release tag. While this repository is pre-release, the publish-capable workflow is `workflow_dispatch` only; automatic `v*` tag releases can be enabled when the server is ready. The release produces `ZITADEL Preview` GitHub Releases, multi-arch archives named `zitadel-preview_<version>_<os>_<arch>`, per-arch Docker images, and a `ghcr.io/zitadel/zitadel-preview` manifest list. `ghcr.io/zitadel/nextgen` is retained as a temporary compatibility alias while the repository is still named nextgen. The console SPA is built by Vite during goreleaser's `before.hooks` and embedded into the binary via `//go:embed`. GoReleaser jobs prune Changesets-created npm package tags (`@zitadel/*`) from the local checkout before running so scoped package tags are never interpreted as server release tags.
2. **TypeScript packages**: released by `changesets` via the [`release-npm.yml`](../../.github/workflows/release-npm.yml) workflow. The public preview packages are `@zitadel/cli` (`apps/cli/`), `@zitadel/api`, `@zitadel/components`, `@zitadel/sdk-core`, `@zitadel/sdk-next`, `@zitadel/sdk-nuxt`, `@zitadel/sdk-react`, `@zitadel/sdk-vue`, and `@zitadel/sdk-angular`. Every other workspace package is marked `"private": true` and never publishes. Each PR adds a `.changeset/*.md` describing the bump; pushing changesets to `main` opens a "Version Packages" PR aggregating pending changes, and merging that PR versions the packages and publishes them to npm. Authentication uses **npm trusted publishing (OIDC)** — there is no `NPM_TOKEN`. npm provenance is disabled while the repository is private because npm only accepts provenance attestations from public source repositories; re-enable it when `zitadel/nextgen` is public. The repo is in changesets **prerelease mode** (`.changeset/pre.json`, tag `alpha`): versions are cut as `X.Y.Z-alpha.N`, the public preview packages are fixed together for the MVP preview train, and publishing uses the `preview` npm dist-tag until `changeset pre exit` cuts a stable `latest` release.
3. **The console SPA is intentionally not a separately versioned npm package.** It is the Go server's UI; it ships embedded in the server binary at the server's version. If a future use case calls for a standalone console library, it becomes a new entry under `packages/` managed by changesets, and the Go server pins a specific version.

Cross-package coordination is handled via changeset notes and peer-dep ranges, not unified tags. During the MVP preview phase, the public preview npm packages are temporarily fixed together so one `@zitadel/cli@preview` handout maps to a tested SDK/component bundle and server image.

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
- Release cadences stay independent outside the MVP preview train. A bug fix in `@zitadel/cli` does not inherently require a server release; a server patch does not inherently bump CLI versions.
- New contributors recognize both workflows from prior projects.
- The `.changeset/*.md` files in PRs make user-visible changes self-documenting before release, even before npm publishing automation is enabled.

Trade-offs:

- Two release tools to learn. New maintainers need to know both `goreleaser` (for the server) and `changesets` (for npm).
- Cross-artifact compatibility still needs an explicit bundle gate: preview releases verify that public package versions match the release tag, and the CLI defaults to the matching `ghcr.io/zitadel/zitadel-preview:<cli-version>` image.
- The console SPA cannot be consumed standalone without re-architecting it as a `packages/console-ui` library. We accept this trade for now because the SPA is tightly coupled to the server's API and capability handshake.

## Alternatives considered

- **`release-please` (Google).** Handles Go and npm in a single tool using conventional commits. Heavier, less idiomatic for pnpm workspaces, and changesets' explicit `.changeset/*.md` files give clearer per-PR signal than commit-message scraping.
- **`nx release`.** Native to the Nx workspace already in use. npm-focused; would still need a Go-side companion. Adds one more vendor-specific tool without removing `goreleaser`.
- **Custom workflows with tag-pattern matchers** (e.g. `cli-v*`, `components-v*`, `v*`). Maximum flexibility but reinvents what changesets and goreleaser already do well, and pushes maintenance burden onto the team.
- **Single all-in-one tag.** A `v1.2.3` tag releasing server + CLI + components together. Couples cadences artificially: every CLI patch becomes a server release.

## Open questions

- When to relax the temporary fixed public-package group after the MVP preview phase.
- When to layer image signing (`cosign`) and SLSA provenance attestations onto the goreleaser pipeline. Out of scope for the initial setup, but the `release.yml` workflow already requests `id-token: write` so the keyless flow is available when needed. npm provenance for the TypeScript packages should be re-enabled once the source repository is public.
- Whether to publish the console SPA as a documentation/preview artifact (e.g., to a CDN bucket) for design reviews, separate from the embedded Go server release.
- When to run `changeset pre exit` to leave the `alpha` prerelease line and cut the first stable `latest` release.

## Follow-up

- ✅ The `@zitadel` npm scope is owned (the main `zitadel` repo already publishes `@zitadel/client` and `@zitadel/proto` under it).
- ✅ The changesets publishing workflow ([`release-npm.yml`](../../.github/workflows/release-npm.yml)) is enabled, using npm trusted publishing (OIDC) — no `NPM_TOKEN` secret. Provenance is disabled while this source repository is private.
- ✅ Package-level GitHub Releases are disabled in the changesets workflow; GoReleaser owns the product-level `ZITADEL Preview` releases.
- ✅ The current public package names exist on npm. New public packages still need package creation and GitHub Actions trusted publishing configuration before they join the release bundle. See [`.changeset/README.md`](../../.changeset/README.md).
- One-time cleanup: run `node scripts/delete-package-github-releases.mjs` to preview old `@zitadel/*` GitHub Releases, then rerun with `--execute` to delete those GitHub Release entries while keeping the git tags and npm releases.
- Decide when to switch the Go release workflow from manual `workflow_dispatch` to automatic `v*` tag releases.
- Draft a `CONTRIBUTING.md` section pointing contributors at `pnpm changeset` for npm changes and conventional commit prefixes for the goreleaser changelog.
- Decide ADR 003 territory: should server config schemas or other stable contracts have their own release/versioning policy that crosses both tools?
