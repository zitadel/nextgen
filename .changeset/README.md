# Changesets

A changeset records a PR's **release intent** — it feeds the generated changelog
and the `v<version>` GitHub Release notes, and drives npm versions, prerelease
policy, and package tag generation. Moon promotes the resulting prebuilt npm
tarballs. This file is the source of truth for "do I need one?"; other docs
link here.

## Publishable npm packages

The public `@zitadel/*` packages are the `fixed` group in
[`.changeset/config.json`](config.json). Other workspaces do not publish, and
`AGENTS.md` files under publishable roots do not need a changeset on their own.

`packages/config/` publishes `@zitadel/config` and is part of that fixed group.

## When a change needs a changeset

A change needs a changeset if it changes what the shipped product does —
**release intent is product-level, not path-level.** The Go server, its API
surface (`api/openapi/**`), and the SDKs all ship as one versioned bundle, so a
server or API change needs one (list `@zitadel/server`) — even from `internal/`
or `api/generated/**` — because it ships new server and SDK versions that belong
in the release notes.

Skip a changeset **only** when the change is *exclusively*:

- tests (`*_test.go`, `*.spec.ts`, …)
- generated mocks or fixtures
- docs or comments (`docs/`, `AGENTS.md`, READMEs)
- CI / build wiring (`.github/`, `moon.yml`, `.changeset/`)
- a refactor with no behavior change

## Decision table

| If the PR… | Add `.changeset/*.md`? | **Release notes / changeset** |
| --- | --- | --- |
| Changes shipped product behavior (any path) | **Yes** — real changeset | Name the file; summarize the note. List `@zitadel/server` for server changes |
| Is *exclusively* tests, generated mocks, docs, CI, or a no-op refactor | **No** | `No changeset required — no shipped behavior changed.` |
| Touches a publishable path but ships nothing (rare) | **Empty changeset** | Say why the path changed but nothing ships |

## How to add a changeset

Humans run `corepack pnpm changeset` and pick the packages, bump type, and a
one-line summary. Agents write `.changeset/<slug>.md` directly — don't rely on
the interactive prompt:

```md
---
"@zitadel/cli": minor
---

One-line, user-facing summary.
```

Use [public package names](#publishable-npm-packages) and `patch` / `minor` /
`major`. For the rare empty changeset (publishable path, nothing ships):
`corepack pnpm changeset --empty`.

## Verify locally

```sh
corepack pnpm exec changeset status --since origin/main
```

Confirm the planned bumps, then state the [decision-table](#decision-table)
outcome in the PR. The command sees npm paths only — it can't infer server impact
from Go paths, so judge those from the table.

## Alpha prerelease mode

The repo is in changesets prerelease mode, tag `alpha` (`.changeset/pre.json`):

- `changeset version` cuts `0.1.0-alpha.N`; consumed changesets are recorded in
  `pre.json`, pending ones stay in the tree.
- The fixed group versions together; release promotion reads the `alpha` npm
  dist-tag from `pre.json`, publishes the exact prebuilt tarballs, and repairs
  that tag if an idempotent rerun finds it stale.

Leave alpha for a stable `latest` release:

```sh
corepack pnpm changeset pre exit
corepack pnpm changeset version   # strips -alpha
```

## Publishing

On merge to `main`, `release-publish.yml` opens a "Version Packages" PR — via the
changesets action, using the release GitHub App token so `full-pr` runs. Merging
it publishes the npm packages, pushes the server container, and updates the draft
GitHub Release for `v<version>`. Normal manual reruns pin the dispatch-selected
commit. To recover an older release after `main` has moved, supply both
`release_ref=<full commit or tag>` and `recover_version=<version>`; promotion
verifies the pinned commit and artifact metadata, skips npm versions already
present, and leaves the active `alpha` or `latest` dist-tag unchanged.
Full steps: [release runbook](../docs/runbooks/manual-release.md). Ownership and
rationale: [ADR 002](../docs/adrs/002-multi-package-release-strategy.md)
(supersedes [ADR 023](../docs/adrs/023-lockstep-alpha-release-train.md)).

Publishing uses **npm trusted publishing (OIDC)** for `npm publish` — there is no
general `NPM_TOKEN`. Once per public package, a maintainer adds a trusted
publisher on npmjs.com (Settings → Trusted Publishing): provider GitHub Actions,
repo `zitadel/nextgen`, workflow `release-publish.yml`. The package must exist on
npm first (publish `0.0.x` by hand if needed). The credentialed publish job runs
on a GitHub-hosted runner because npm does not support trusted publishing from
self-hosted runners.

npm does not authorize `dist-tag` mutations through trusted-publishing OIDC.
Configure `NPM_DIST_TAG_TOKEN` as a short-lived, package-scoped granular token
for the release workflow. Automation maps it to npm's `NODE_AUTH_TOKEN` only
for a stale-tag repair or historical-recovery cleanup command; normal package
publication remains OIDC.

Each public package must declare its license and ship a `LICENSE` file before its
first publish — see [LICENSING.md](../LICENSING.md).
