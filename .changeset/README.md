# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) for
the public release surfaces in this monorepo. Changesets are the per-PR release
intent that feeds the generated changelogs and the single GitHub Release notes
draft for `v<version>`. They also drive npm package versions and publishing.
For "do I need a changeset on this PR?", see
[Release notes and shared version tags](#release-notes-and-shared-version-tags),
[Publishable npm packages](#publishable-npm-packages),
[Go server runtime changes](#go-server-runtime-changes), and the
[Decision table](#decision-table).

## PR workflow and visibility

Pull requests get an informational Changesets comment from
[`changesets/action/pr-status`](https://github.com/changesets/action/tree/maintenance/v1/pr-status).
Use that comment and the decision table below to review whether the PR has the
right release intent before merging.

Branch protection currently requires the GitHub Actions context `full-pr`,
shown in the pull request UI as `ci / full-pr`. Changesets PR comments are
visibility only; they are not a blocking release-policy gate.

## Release notes and shared version tags

Nextgen publishes one product release at a time during alpha. The GitHub Release
for `v<version>` is the place users check what changed across the CLI, SDKs,
API packages, Go server runtime, containers, archives, and server npm packages.
The container image and server artifacts use the same version tag as the fixed
Changesets release group.

That means release intent is about the product release, not only about whether a
specific npm package path changed. If shipped server behavior changes, users
need to see that in the release notes for the same version that tags the
container and server artifacts.

## Publishable npm packages

**Publishable npm packages** are the public `@zitadel/*` packages that ship to
npm. This list mirrors the fixed release group in
[`.changeset/config.json`](config.json); if the prose and config ever drift, the
config is the source of truth.

- `apps/cli/` — `@zitadel/cli`
- `apps/server/` — `@zitadel/server`
- `apps/server-linux-x64/` — `@zitadel/server-linux-x64`
- `apps/server-linux-arm64/` — `@zitadel/server-linux-arm64`
- `apps/server-darwin-x64/` — `@zitadel/server-darwin-x64`
- `apps/server-darwin-arm64/` — `@zitadel/server-darwin-arm64`
- `apps/server-win32-x64/` — `@zitadel/server-win32-x64`
- `packages/api/` — `@zitadel/api`
- `packages/components/` — `@zitadel/components`
- `packages/sdk-core/` — `@zitadel/sdk-core`
- `packages/sdk-next/` — `@zitadel/sdk-next`
- `packages/sdk-nuxt/` — `@zitadel/sdk-nuxt`
- `packages/sdk-react/` — `@zitadel/sdk-react`
- `packages/sdk-vue/` — `@zitadel/sdk-vue`
- `packages/sdk-angular/` — `@zitadel/sdk-angular`
- `packages/sdk-solid/` — `@zitadel/sdk-solid`
- `packages/sdk-svelte/` — `@zitadel/sdk-svelte`
- `packages/sdk-qwik/` — `@zitadel/sdk-qwik`

`AGENTS.md` files under those roots do not require a changeset on their own.

Non-publishable files such as root `docs/`, `.github/`, demos, and private
workspaces do not require a changeset on their own. Other workspaces such as
`@zitadel/api-mock`, `@zitadel/design-tokens`,
`@zitadel/shared-component-styles`, `@zitadel/ui-react`, and `@zitadel/lint`
are marked `"private": true` and are never published.

Do not use touched paths as the only release-intent test. The Go server is
implemented mostly outside `apps/server*`, but server changes still belong in
the single GitHub Release notes and on the same versioned release train as the
container, archives, `@zitadel/server`, and platform server packages.

## Go server runtime changes

Add a real changeset for `@zitadel/server` when a PR changes shipped server
behavior, even if the files live under implementation paths such as
`internal/`, `cmd/`, `api/openapi/`, storage migrations, or embedded static UI
inputs. The primary reason is release-note visibility for the unified GitHub
Release and shared container/server version tags; npm publication is one of the
distribution mechanisms attached to that same release.

Examples that usually need a real `@zitadel/server` changeset:

- HTTP API behavior, OpenAPI contract, auth/session semantics, lifecycle
  semantics, data migrations, defaults, configuration, runtime startup, or
  security behavior changes that users can experience.
- Bug fixes in Go handlers, services, repositories, migrations, or runtime
  packaging that change what the published server does.
- New customer-usable server capability, route, configuration option, or local
  runtime behavior.

Examples that usually do not need a changeset:

- Go-only test changes, repository-only refactors with no shipped behavior
  change, comments, contributor docs, generated mocks, or CI/build wiring that
  does not change a public package or product runtime.

For Go runtime changes, list `@zitadel/server` in the changeset so the generated
changelog and draft GitHub Release include the server note. If the same PR also
changes another public package surface, such as `@zitadel/api` or an SDK
contract, list that package too. The fixed Changesets group moves the server
platform packages and the rest of the alpha release train to the same version;
Moon uses that server version for containers, archives, and the draft GitHub
Release shell.

## User-visible changes

**User-visible** means someone consuming the shipped product would notice:
exported APIs/types, CLI command surface or JSON contract, published component
behavior, server runtime/API behavior, data/lifecycle semantics, or install/setup
docs shipped in a public package. Internal refactors, tests-only edits, and
contributor-only files are not user-visible unless they change what ships.

Use the release-note reader's perspective when picking the changeset wording.
Do not call internal prework a feature unless customers can use a new capability
in the release being cut. Prefer:

- `patch` / `fix` wording for customer-visible correctness, compatibility, or
  behavior fixes.
- `minor` / feature wording only for new customer-usable capabilities.
- No changeset for a pure refactor with no shipped behavior.

Semantic PR titles and Changesets both describe release intent, but they answer
different review questions. If structural work has no shipped behavior change,
`refactor(...)` and no changeset usually fit. If the change fixes
customer-visible behavior, prefer `fix(...)` and add a `patch` changeset. If it
exposes a new customer-usable capability, prefer `feat(...)` and add a `minor`
changeset.

## Decision table

Follow in order before opening a PR:

| If the PR… | Add `.changeset/*.md`? | **Release notes / changeset** section |
| --- | --- | --- |
| Does **not** modify any publishable path and does **not** change shipped server/runtime behavior | **No** | `No changeset required — no public package or shipped server behavior changed.` |
| Changes shipped Go server/runtime/API behavior from any path | **Yes** — real changeset for `@zitadel/server` | Name the file and summarize the server/runtime release note users should read |
| Modifies publishable paths **and** has user-visible public package impact | **Yes** — real changeset | Name the file and summarize the consumer-facing note |
| Modifies publishable paths only for non-shipping reasons (e.g. package-internal test) | **Rare:** empty changeset | Explain why the path changed but nothing ships |

## How to add a changeset

**Humans** can run the interactive prompt:

```sh
corepack pnpm changeset
```

Pick the affected packages, the bump type (patch / minor / major), and write a
one-line summary. A markdown file appears in this directory and gets committed
with your PR.

**Agents and automation** should write the file directly — do not depend on the
interactive prompt. Create `.changeset/<short-slug>.md`:

```md
---
"@zitadel/cli": minor
---

One-line, user-facing summary of the change.
```

List only public package names (`@zitadel/cli`, `@zitadel/server`,
`@zitadel/server-*`, `@zitadel/api`, `@zitadel/components`,
`@zitadel/sdk-core`, `@zitadel/sdk-next`, `@zitadel/sdk-nuxt`,
`@zitadel/sdk-react`, `@zitadel/sdk-vue`, `@zitadel/sdk-angular`,
`@zitadel/sdk-solid`, `@zitadel/sdk-svelte`, `@zitadel/sdk-qwik`). For shipped
Go server behavior, list `@zitadel/server`. Pick `patch` (fixes), `minor`
(features), or `major` (breaking). The repo is in `alpha` prerelease mode
(`.changeset/pre.json`) and public packages are in one fixed group, so versions
cut as one `X.Y.Z-alpha.N` train automatically — see
[Alpha prerelease mode](#alpha-prerelease-mode).

## Empty changeset

**Empty changeset** (rare) — only when publishable paths changed but nothing
should ship: `corepack pnpm changeset --empty`. Do not use an empty changeset
as a substitute for release intent. For Go implementation paths, choose between:
no changeset when no shipped behavior changes, or a real `@zitadel/server`
changeset when shipped server behavior changes.

## Anti-patterns

- Do **not** add an empty changeset on PRs that only touch non-publishable paths
  and have no shipped server behavior change.
- Do **not** skip a real changeset when changing published CLI, server runtime,
  SDK, API, or component behavior, even when the server change is implemented
  under `internal/`, `cmd/`, `api/openapi/`, or a migration path.

## Verify locally

Before handoff:

```sh
corepack pnpm exec changeset status --since origin/main
```

Use the output to confirm that Changesets sees the intended package bumps, then
state the correct PR outcome from the decision table above. This command cannot
infer server runtime impact from Go implementation paths by itself; review that
intent manually and add an `@zitadel/server` changeset when the server change
belongs in the unified release notes.

The public packages above are in one Changesets fixed group while the repo is
in alpha, so a version PR moves the CLI, SDKs, API packages, Go server runtime,
and server npm artifacts together.

## Alpha prerelease mode

The repo is currently in changesets **prerelease mode** with the `alpha` tag (see `.changeset/pre.json`). While in this mode:

- `changeset version` cuts versions like `0.1.0-alpha.0`, `0.1.0-alpha.1`, …
- Pending `.changeset/*.md` files remain in the tree after versioning; consumed
  changesets are recorded in `.changeset/pre.json`.
- Public product packages are versioned together through the fixed group.
- `changeset publish` publishes public npm packages under the **`alpha`** npm dist-tag while prerelease mode is active.
- A package that has never had a stable release is published to `latest` on its first publish (changesets behaviour), then to `alpha` thereafter until it has a stable release.

To leave alpha and cut a stable `latest` release:

```sh
corepack pnpm changeset pre exit
corepack pnpm changeset version   # strips the -alpha suffix
```

## Publishing (npm trusted publishing / OIDC)

When pending changesets are merged to `main`, `release-publish.yml` runs the
[changesets GitHub Action](https://github.com/changesets/action) to open or
update a "Version Packages" PR aggregating pending changesets. It uses the
release GitHub App token rather than the default `GITHUB_TOKEN`, so the version
PR triggers the required `full-pr` check normally. After that PR merges and CI
is green, the same workflow detects the generated version commit, runs Moon
release tasks, publishes npm packages with `changeset publish`, and pushes
server containers. Moon also creates or updates the draft GitHub Release shell
for `v<version>` with generated artifact and package facts. Manual
workflow dispatch is available for dry-runs. Use `release-publish` with
`recover_version=<version>` to recover any missing publish-side artifact for an
already-versioned release.
`changeset publish` publishes only package versions that are not already present
on npm, so the same recovery path is used whether npm packages or containers
are missing.

Publishing authenticates with **npm trusted publishing (OIDC)** — there is **no `NPM_TOKEN`** secret. Before the first automated publish, a maintainer must, once per public package:

1. Ensure the package exists on npm (publish `0.0.x` manually the first time if needed, since a trusted publisher can only be attached to an existing package).
2. On npmjs.com → the package → **Settings → Trusted Publishing**, add a publisher:
   - Provider: **GitHub Actions**
   - Organization/owner: `zitadel`
   - Repository: `nextgen`
   - Workflow filename: `release-publish.yml` (exact, case-sensitive)
3. Optionally, under **Publishing access**, require 2FA and disallow tokens so only this workflow can publish.

While this repository is private, the workflow keeps npm provenance disabled
with `NPM_CONFIG_PROVENANCE=false`. Trusted publishing still authenticates with
short-lived OIDC credentials, but npm only accepts public provenance
attestations from public source repositories. Re-enable provenance when
`zitadel/nextgen` is public.

Changesets publishes the npm packages, including `@zitadel/server`. Moon
release tasks read the `@zitadel/server` version, cross-build the Go server,
stage the platform npm package binaries, publish containers, and create or
update the draft GitHub Release shell for `v<version>`. Product release prose is
written manually by maintainers before they publish the draft.
See
[docs/adrs/002-multi-package-release-strategy.md](../docs/adrs/002-multi-package-release-strategy.md)
and [docs/adrs/023-lockstep-alpha-release-train.md](../docs/adrs/023-lockstep-alpha-release-train.md).

## Licensing reminder

Most npm packages published from this repo are **MIT-licensed**. Public
packages under `apps/cli/` and `packages/*` must set `"license": "MIT"` and
ship a package-level `LICENSE` file before publishing. The `apps/server*`
packages ship the AGPL server binary and use `"license": "AGPL-3.0-only"`.
Private demo, design-system, and integration workspaces are covered by the path
exceptions in [/LICENSING.md](../LICENSING.md) while they remain private.
