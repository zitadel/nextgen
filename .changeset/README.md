# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) for
this monorepo. A changeset records the **per-PR release intent** that feeds the
generated changelog and the `v<version>` GitHub Release notes; it also drives npm
package versions and publishing.

This file is the single source of truth for "do I need a changeset on this PR?" —
other docs link here instead of restating the rules. Start with
[When a change needs a changeset](#when-a-change-needs-a-changeset) and the
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

The public `@zitadel/*` packages are the `fixed` group in
[`.changeset/config.json`](config.json). Other workspaces do not publish, and
`AGENTS.md` files under publishable roots do not need a changeset on their own.

## When a change needs a changeset

Release intent is **product-level, not path-level**. Assume a change needs a
changeset if it changes what the shipped product does. Skip it **only** when the
change is *exclusively* one of:

- test files (`*_test.go`, `*.spec.ts`, `*.browser.spec.ts`)
- generated build output and test mocks (`dist/**`, generated mocks) — but
  regenerating `api/generated/**` from an `api/openapi/**` contract change is a
  shipped change, not a skip
- comments or contributor docs (`docs/`, `AGENTS.md`, READMEs)
- CI / build wiring (`.github/`, `moon.yml`, `.changeset/` itself)
- a refactor with no behavior change

This is why a shipped Go server change still needs a changeset even when it lives
under an implementation path like `internal/` or `cmd/` rather than a published
package directory: list `@zitadel/server` so the change gets a line in the
generated changelog and the `v<version>` release notes.

The public packages are one Changesets **fixed** group, so every package version
bumps together from any changeset — the `@zitadel/server` entry is not what makes
the server ship or version, it is what gives the change a release-note line. Pick
`patch` (fixes), `minor` (features), or `major` (breaking).

## Decision table

| If the PR… | Add `.changeset/*.md`? | **Release notes / changeset** section |
| --- | --- | --- |
| Changes shipped product behavior (any path) | **Yes** — real changeset | Name the file and summarize the release note; list `@zitadel/server` for server changes |
| Is *exclusively* tests, generated output, docs, CI, or a no-op refactor (see [When a change needs a changeset](#when-a-change-needs-a-changeset)) | **No** | `No changeset required — no shipped behavior changed.` |
| Changes a publishable path but nothing should ship (rare — e.g. a package-internal test) | **Empty changeset** | Explain why the path changed but nothing ships |

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

List only [public package names](#publishable-npm-packages); bump-type and
when-to-add are covered in
[When a change needs a changeset](#when-a-change-needs-a-changeset). The repo is
in `alpha` prerelease mode (`.changeset/pre.json`), so versions cut as one
`X.Y.Z-alpha.N` train automatically — see
[Alpha prerelease mode](#alpha-prerelease-mode).

## Empty changeset

Use an empty changeset only when a publishable path changed but nothing should
ship: `corepack pnpm changeset --empty`. Don't reach for it to dodge a real
changeset when behavior actually ships.

## Verify locally

Before handoff:

```sh
corepack pnpm exec changeset status --since origin/main
```

Confirm Changesets sees the intended bumps, then state the
[decision-table](#decision-table) outcome in the PR. Note the command reads npm
package paths only — it cannot infer server impact from Go paths, so decide those
from the table yourself.

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
