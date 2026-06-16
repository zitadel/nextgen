# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) for
the npm-published packages in this monorepo. For "do I need a changeset on this
PR?", see [Publishable npm packages](#publishable-npm-packages) and the
[Decision table](#decision-table).

## PR workflow and visibility

Pull requests get an informational Changesets comment from
[`changesets/action/pr-status`](https://github.com/changesets/action/tree/maintenance/v1/pr-status).
Use that comment and the decision table below to review whether the PR has the
right release intent before merging.

Branch protection currently requires the GitHub Actions context `full-pr`,
shown in the pull request UI as `ci / full-pr`. Changesets PR comments are
visibility only; they are not a blocking release-policy gate.

## Publishable npm packages

**Publishable npm packages** are the public `@zitadel/*` packages that ship
to npm:

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

`AGENTS.md` files under those roots do not require a changeset on their own.

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
corepack pnpm exec changeset status --since origin/main
```

Use the output to confirm that Changesets sees the intended package bumps, then
state the correct PR outcome from the decision table above.

The public packages above are in one Changesets fixed group while the repo is
in alpha, so a version PR moves the CLI, SDKs, API packages, and server npm
runtime together.

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
