# Changesets

A changeset records a PR's **release intent** — it feeds the generated changelog
and the `v<version>` GitHub Release notes, and drives npm versions and publishing.
This file is the source of truth for "do I need one?"; other docs link here.

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

The console (`apps/console/**`) and login UI (`apps/login-ui/**`) are embedded in
the server container, so a user-visible change there ships too and needs a
changeset listing `@zitadel/server`. They publish no npm package of their own —
that is why they sit in the `ignore` list — but a customer still receives the
change.

Skip a changeset **only** when the change is *exclusively*:

- tests (`*_test.go`, `*.spec.ts`, …)
- generated mocks or fixtures
- docs or comments (`docs/`, `AGENTS.md`, READMEs)
- CI / build wiring (`.github/`, `moon.yml`, `.changeset/`)
- a refactor with no behavior change

## Decision table

The same answer picks the changeset **and** the PR title type — both ask whether
a customer gets something. Full title rule:
[`CONTRIBUTING.md#title-format`](../CONTRIBUTING.md#title-format).

| If the PR… | Add `.changeset/*.md`? | **Release notes / changeset** | PR title type |
| --- | --- | --- | --- |
| Changes shipped product behavior (any path) | **Yes** — real changeset | Name the file; summarize the note. List `@zitadel/server` for server changes | `feat` / `fix` — never `docs` or `chore` |
| Changes what the console or login UI does for a user | **Yes** — list `@zitadel/server` | Name the file; summarize the note | `feat(console)` / `fix(login)` |
| Is *exclusively* tests, generated mocks, docs, CI, or a no-op refactor | **No** | `No changeset required — no shipped behavior changed.` | `test` / `docs` / `ci` / `build` / `chore` / `refactor` — never `feat` or `fix` |
| Touches a publishable path but ships nothing (rare) | **Empty changeset** | Say why the path changed but nothing ships | Not `feat` or `fix` |

A changeset does not by itself justify `feat` or `fix`: an internal restructure
under `internal/` still ships a server version, and stays `refactor`.

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

### The summary is the release note

`@changesets/changelog-github` renders that summary **verbatim** into
`CHANGELOG.md` and the `v<version>` GitHub Release. The PR title never appears
there — only a link. So the summary is the copy a customer actually reads, and it
has to stand on its own for someone with no access to this repo.

- Lead with what the reader can now do, or what stopped being broken.
- Name the surface they touch: `zitadel setup`, `<zitadel-login>`,
  `@zitadel/sdk-react`, the console.
- No ADR numbers, PR numbers, internal file paths, or words like "foundation",
  "wiring", or "POC". Those belong in the PR description.
- Say what a reader must do differently when behavior changes.

```md
<!-- bad: names our internals, means nothing to a reader -->
Implement ADR 030 errreport foundation in internal/errreport.

<!-- good: outcome first, then the action it implies -->
Default password hashing is now `argon2id` instead of bcrypt. Existing hashes
keep validating and are rehashed on the next successful sign-in; set
`password_hasher.hasher.algorithm` to `bcrypt` to keep the previous behavior.
```

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
- The fixed group versions together; `changeset publish` uses the `alpha` npm
  dist-tag.

Leave alpha for a stable `latest` release:

```sh
corepack pnpm changeset pre exit
corepack pnpm changeset version   # strips -alpha
```

## Publishing

On merge to `main`, `release-publish.yml` opens a "Version Packages" PR — via the
changesets action, using the release GitHub App token so `full-pr` runs. Merging
it publishes the npm packages, pushes the server container, and updates the draft
GitHub Release for `v<version>`. Re-run with `recover_version=<version>` to
backfill a missing artifact; `changeset publish` skips versions already on npm.
Full steps: [release runbook](../docs/runbooks/manual-release.md). Ownership and
rationale: [ADR 002](../docs/adrs/002-multi-package-release-strategy.md)
(supersedes [ADR 023](../docs/adrs/023-lockstep-alpha-release-train.md)).

Publishing uses **npm trusted publishing (OIDC)** — there is no `NPM_TOKEN`. Once
per public package, a maintainer adds a trusted publisher on npmjs.com (Settings →
Trusted Publishing): provider GitHub Actions, repo `zitadel/nextgen`, workflow
`release-publish.yml`. The package must exist on npm first (publish `0.0.x` by
hand if needed). The release job runs on Depot, which npm treats as self-hosted;
keep `NPM_CONFIG_PROVENANCE=false` until npm provenance is supported for that
runner environment or the publish job moves to GitHub-hosted runners.

Each public package must declare its license and ship a `LICENSE` file before its
first publish — see [LICENSING.md](../LICENSING.md).
