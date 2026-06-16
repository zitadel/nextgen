# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) for
the npm-published packages in this monorepo. For "do I need a changeset on this
PR?", see [Publishable npm packages](#publishable-npm-packages) and the
[Decision table](#decision-table).

## PR workflow and CI gate

CI runs a dedicated `changesets / status` check from
[`.github/workflows/changesets.yml`](../.github/workflows/changesets.yml). The
check runs
[`scripts/check-changesets-status.mjs`](../scripts/check-changesets-status.mjs)
through Moon:

```sh
moon run release:changesets -- --base origin/main --summary
```

It passes when no **publishable package path** changed, fails when publishable
package paths changed without a `.changeset/*.md` file, validates that
changesets name only public packages, and verifies that the fixed alpha group
matches the product package list below.

Branch protection currently requires the GitHub Actions context `full-pr`,
shown in the pull request UI as `ci / full-pr`. The `changesets / status`
workflow is fast release feedback unless repository settings are updated to
require it too.

Publishable paths are defined in
[`scripts/check-changesets-status.mjs`](../scripts/check-changesets-status.mjs);
update that script and this doc together.

## Publishable npm packages

**Publishable npm packages** are the public `@zitadel/*` packages that ship
to npm. CI checks **repo paths** (must match the script's `publicPackages`):

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

`AGENTS.md` files under those roots are ignored by the gate and do not require a
changeset on their own.

Everything else — `internal/`, `docs/`, `.github/`, `apps/console/`,
`packages/api-mock/`, demos, and other private workspaces — does **not** require
any changeset file. Other workspaces such as
`@zitadel/api-mock`, `@zitadel/design-tokens`, `@zitadel/shared-component-styles`,
`@zitadel/ui-react`, and `@zitadel/lint` are marked `"private": true` and are
never published.

## User-visible changes

**User-visible** means npm consumers would notice: exported APIs/types, CLI
command surface or JSON contract, published component behavior, or install/setup
docs shipped in the package. Internal refactors, tests-only edits, and
contributor-only files are not user-visible unless they change what publishes.

## Decision table

Follow in order before opening a PR:

| If the PR… | Add `.changeset/*.md`? | **Release notes / changeset** section |
| --- | --- | --- |
| Does **not** modify any publishable path above | **No** | `No changeset required — no public npm package files changed.` |
| Modifies publishable paths **and** has user-visible npm impact | **Yes** — real changeset | Name the file and summarize the consumer-facing note |
| Modifies publishable paths only for non-shipping reasons (e.g. package-internal test) | **Rare:** empty changeset to satisfy CI | Explain why the path changed but nothing ships |

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
`@zitadel/sdk-react`, `@zitadel/sdk-vue`, `@zitadel/sdk-angular`). Pick `patch`
(fixes), `minor` (features), or `major` (breaking). The repo is in `alpha`
prerelease mode (`.changeset/pre.json`) and public packages are in one fixed
group, so versions cut as one `X.Y.Z-alpha.N` train automatically — see
[Alpha prerelease mode](#alpha-prerelease-mode).

## Empty changeset

**Empty changeset** (rare) — only when publishable paths changed but nothing
should ship: `corepack pnpm changeset --empty`. Do **not** use this for Go
implementation-only paths (`internal/`, `cmd/`, `api/openapi/`), root `docs/`,
CI-only, or other PRs that never touch the publishable paths above.

## Anti-patterns

- Do **not** add an empty changeset on PRs that only touch non-publishable
  paths (for example `internal/`, `docs/`, `.github/`, storage migrations).
- Do **not** skip a changeset when changing published CLI, server runtime, SDK,
  or components behavior under the publishable paths above.

## Verify locally

Before handoff:

```sh
moon run release:changesets -- --base origin/main --summary
```

Exit `0` -> the changeset gate is satisfied; use the decision table above to
state the correct PR outcome. Exit `1` -> add a changeset (real or, rarely,
empty), fix package names in changeset frontmatter, or repair the fixed alpha
group.

The public packages above are in one Changesets fixed group while the repo is
in alpha, so a version PR moves the CLI, SDKs, API packages, and server npm
runtime together.

Before forcing release preparation manually, validate all pending changesets
with:

```sh
moon run release:changesets -- --pending --summary
```

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

When pending changesets are merged to `main`, `release-prepare.yml` validates
them, then runs the [changesets GitHub Action](https://github.com/changesets/action)
to open or update a "Version Packages" PR aggregating pending changesets. It
uses the release GitHub App token rather than the default `GITHUB_TOKEN`, so the
version PR triggers the required `full-pr` check normally. After that PR merges
and CI is green, `release-publish.yml` automatically runs Moon release tasks,
publishes npm packages with `changeset publish`, pushes server containers, and
updates the product GitHub Release. Manual workflow dispatch remains available
for retrying prepare, dry-running publish, or recovering from external registry
problems.

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
release tasks read the `@zitadel/server` version, create `v<version>`,
cross-build the Go server, stage the platform npm package binaries, publish
containers, and update the single product GitHub Release. See
[docs/adrs/002-multi-package-release-strategy.md](../docs/adrs/002-multi-package-release-strategy.md)
and [docs/adrs/023-lockstep-alpha-release-train.md](../docs/adrs/023-lockstep-alpha-release-train.md).

## Licensing reminder

Most npm packages published from this repo are **MIT-licensed**. Public
packages under `apps/cli/` and `packages/*` must set `"license": "MIT"` and
ship a package-level `LICENSE` file before publishing. The `apps/server*`
packages ship the AGPL server binary and use `"license": "AGPL-3.0-only"`.
Private demo, design-system, and integration workspaces are covered by the path
exceptions in [/LICENSING.md](../LICENSING.md) while they remain private.
