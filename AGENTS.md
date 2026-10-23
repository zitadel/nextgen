# Agent Instructions

Zitadel nextgen is the pre-release next generation of the Zitadel identity
platform: a Go server and its OpenAPI contract, the `zitadel` CLI, SDKs, login
components and the console, in one Moon monorepo.

This file routes and holds repo-wide rules. Before changing files under a path,
read its nearest scoped `AGENTS.md`: it holds that path's rules and wins on
conflict.

## Map

`moon projects` lists every project; this table maps roles.

| Path | What it is | Rules |
| --- | --- | --- |
| `apps/api/` | the Go server module `github.com/zitadel/nextgen`: `main.go`, `cmd/`, `internal/`, `api/` | [internal](apps/api/internal/AGENTS.md), [storage](apps/api/internal/storage/AGENTS.md), [service](apps/api/internal/service/AGENTS.md) |
| `apps/api/api/openapi/` | OpenAPI source of the wire contract | [openapi](apps/api/api/openapi/AGENTS.md) |
| `apps/` | deployable apps | [apps](apps/AGENTS.md) |
| `apps/server/`, `apps/server-*/` | the Go `server:*` tasks, run against `apps/api`; the `@zitadel/server` npm binaries | — |
| `apps/cli/` | the `zitadel` CLI | [cli](apps/cli/AGENTS.md), [tests](apps/cli/tests/AGENTS.md), [local server](apps/cli/src/lib/local-server/AGENTS.md) |
| `apps/console/`, `apps/login-ui/` | the SPAs the server embeds | [console](apps/console/AGENTS.md) |
| `apps/docs/`, `apps/website/` | the docs site; the hosted cloud's front page | [docs](apps/docs/AGENTS.md), [website](apps/website/AGENTS.md) |
| `apps/storybook/` | workbench and a11y gate for the login atoms | [storybook](apps/storybook/AGENTS.md) |
| `apps/demo-*/` | reference apps for the sign-in component | [next](apps/demo-next/README.md), [nuxt](apps/demo-nuxt/README.md) |
| `apps/cloud/` | the hosted cloud | [runbook](docs/runbooks/cloud.md) |
| `e2e/` | every end-to-end lane, moon project `e2e` | [journey](e2e/journey/AGENTS.md), [console](e2e/console/AGENTS.md), [demo-next](e2e/demo-next/AGENTS.md), [demo-nuxt](e2e/demo-nuxt/AGENTS.md) |
| `packages/` | SDKs (`sdk-*`), API client, config schemas | [packages](packages/AGENTS.md) |
| `packages/go/` | the Go API client module `go.zitadel.com/zitadel/v5`, generated with the server | [go](packages/go/AGENTS.md) |
| `packages/components/` | `<zl-*>` atoms, the `<zitadel-login>` orchestrator | [components](packages/components/AGENTS.md) |
| `packages/design-tokens/` | the `--zl-*` tokens both UIs share | [design-tokens](packages/design-tokens/AGENTS.md) |
| `packages/api-mock/` | mock API for demos and tests | [api-mock](packages/api-mock/AGENTS.md) |
| `packages/testing/` | `@zitadel/testing`, the published test kit | [testing](packages/testing/AGENTS.md) |
| `.moon/`, `scripts/` | task graph; scripts behind `workspace:*` | [moon](.moon/AGENTS.md) |
| `docs/` | ADRs, design notes, runbooks | [ADR index](docs/adrs/README.md) |

## Workflow Front Doors

### I am contributing to Zitadel

| I want to...                       | Run                                           |
| ---------------------------------- | --------------------------------------------- |
| Check my setup                     | `moon run workspace:doctor`                   |
| Try the local Zitadel CLI          | `moon run workspace:cli -- --help`            |
| Preview the docs site              | `moon run docs:dev`                           |
| Run the server from source         | `moon run workspace:server -- --help`         |
| Test the fresh-app onboarding path | `moon run e2e:journey`                        |
| Run normal local checks            | `moon ci :lint :typecheck :build :test`       |
| Run CI's slow phases locally       | `moon run workspace:check -- --full`          |
| Check a release or Changesets edit | `moon run workspace:check -- --only release`  |
| Rerun one failed task              | `moon run <project>:<task>`                   |
| Check a PR title                   | `node scripts/check-pr-title.mjs --title "…"` |
| Run the hosted cloud locally       | `moon run workspace:cloud`                    |
| Check a deployment of the cloud    | `CLOUD_URL=<url> pnpm check:cloud`            |

`workspace:*` commands run from this checkout; the published `zitadel` commands
must run without it, Docker, Go or Moon
([CONTRIBUTING.md](CONTRIBUTING.md#testing-the-cli-from-source)).

### I am adding Zitadel to my app

Use the [README's command table](README.md#i-am-adding-zitadel-to-my-app); the
consumer-agent contract is the CLI's
[SKILL.md](apps/cli/skills/zitadel-cli/SKILL.md).

## Hard rules

- **Generated files**: never hand-edit generated output; change its source and
  regenerate (`moon run server:generate` for Go and OpenAPI).
  - CI's `server:check-generate-pruned` fails on drift and on generated files
    nothing generates any more.
  - Do not reintroduce a scheduler-side bootstrap pass for `go generate`;
    `apps/api/api/cmd/gen_openapi_errors` breaks the cycle itself.
  - Keep `mockgen` directives in the mock packages, not beside the interfaces.
- **Resource IDs**: never write ULID/UUID helpers; mint them as
  [storage](apps/api/internal/storage/AGENTS.md) says ([ADR 047](docs/adrs/047-dialect-id-generation.md)).
- **Wire casing**: fields, enum values and parameters are `snake_case`;
  `server:openapi` lints the spec ([openapi](apps/api/api/openapi/AGENTS.md)).
- **CLI contract**: keep `--json` output one parseable envelope on stdout;
  update [SKILL.md](apps/cli/skills/zitadel-cli/SKILL.md) with every behavior change.
- **UI surface**: decide whether a component is console or login UI before
  building it; never copy a flattened app mock ([styling](apps/console/docs/styling.md)).
  - Add or change a login atom by the [Storybook recipe](apps/storybook/AGENTS.md).
- **Login flow**: [default-login.json](packages/config/defaults/default-login.json)
  owns step shape; diff a mock fixture against it before changing the fixture.
- **Console**: develop it with `moon run console:dev-real`; list screens are
  only honest against real data ([console](apps/console/AGENTS.md)).
- **Testing layers**: test at the lowest layer that proves the property, and
  never duplicate upward ([testing](packages/testing/AGENTS.md)).
- **Moon** is the task front door; read [.moon/AGENTS.md](.moon/AGENTS.md)
  before editing a `moon.yml` or `.moon/`.
- **Versions**: the Node major comes from `.nvmrc`; dependencies take caret
  ranges and the pnpm catalog ([rules](CONTRIBUTING.md#nodejs-and-dependency-versions)).
- **Changesets**: follow the [decision table](.changeset/README.md#decision-table);
  write `.changeset/<slug>.md` directly.
- **Pull requests**: write the title and description as
  [CONTRIBUTING.md](CONTRIBUTING.md#opening-a-pull-request) says; the type
  follows who the change reaches.
- **Merging**: merge `main` into a branch only to resolve a conflict or pick up
  a change it needs ([CONTRIBUTING.md](CONTRIBUTING.md#merging)).
- **Licensing**: check a path's license in [LICENSING.md](LICENSING.md) before
  adding a package or moving code across it.
- **Secrets**: keep keys, tokens and `.zitadel/secret`-style files out of
  source control and browser-visible runtime metadata.

## Where to read next

- [ADR index](docs/adrs/README.md): read the relevant ADRs before changing
  behavior.
- [CONTRIBUTING.md](CONTRIBUTING.md): setup, [CI](CONTRIBUTING.md#what-ci-runs),
  [tests](CONTRIBUTING.md#running-integration-and-end-to-end-tests),
  [troubleshooting](CONTRIBUTING.md#troubleshooting).
- Runbooks: [cloud](docs/runbooks/cloud.md),
  [manual release](docs/runbooks/manual-release.md).
- E2E lanes and `e2e:all`: [testing](packages/testing/AGENTS.md);
  a demo on the mock API: [demo-next](apps/demo-next/README.md).

## How to write an AGENTS.md

- Keep only what the code cannot tell an agent: commands, rules, gotchas, and
  pointers to the source of truth.
- One rule per bullet, imperative, at most two lines.
- Do not restate code comments, configs or test assertions, and do not count or
  list things that live in code; link to them.
- No history ("used to", "since #123"). A rule CI enforces gets one line naming
  the check.
- One home per fact; link to it from everywhere else.
