# Agent Instructions

Zitadel nextgen is the pre-release next generation of the Zitadel identity
platform: a Go server and its OpenAPI contract, the `zitadel` CLI, SDKs, login
components and the console, in one Turborepo monorepo.

This file routes and holds repo-wide rules. Before changing files under a path,
read its nearest scoped `AGENTS.md`: it holds that path's rules and wins on
conflict.

## Map

`turbo ls` lists every package; this table maps roles.

| Path | What it is | Rules |
| --- | --- | --- |
| `apps/api/` | the Go server module `github.com/zitadel/nextgen`: `main.go`, `cmd/`, `internal/`, `api/` | [internal](apps/api/internal/AGENTS.md), [storage](apps/api/internal/storage/AGENTS.md), [service](apps/api/internal/service/AGENTS.md) |
| `apps/api/api/openapi/` | OpenAPI source of the wire contract | [openapi](apps/api/api/openapi/AGENTS.md) |
| `apps/` | deployable apps | [apps](apps/AGENTS.md) |
| `apps/server/`, `apps/server-*/` | `@zitadel/server`'s Go tasks, run against `apps/api`; the `@zitadel/server` npm binaries | — |
| `apps/cli/` | the `zitadel` CLI | [cli](apps/cli/AGENTS.md), [tests](apps/cli/tests/AGENTS.md), [local server](apps/cli/src/lib/local-server/AGENTS.md) |
| `apps/console/` | the SPA the server embeds | [console](apps/console/AGENTS.md) |
| `apps/cloud-console/` | the hosted cloud's add-on to the console | [cloud-console](apps/cloud-console/AGENTS.md) |
| `apps/cloud-functions/` | the hosted cloud's backend: RPC, bot check, webhooks, workflows | [cloud-functions](apps/cloud-functions/AGENTS.md) |
| `apps/docs/`, `apps/website/` | the docs site; the hosted cloud's front page | [docs](apps/docs/AGENTS.md), [website](apps/website/AGENTS.md) |
| `apps/storybook/` | workbench and a11y gate for the login atoms | [storybook](apps/storybook/AGENTS.md) |
| `apps/demo-*/` | reference apps for the sign-in component | [next](apps/demo-next/README.md), [nuxt](apps/demo-nuxt/README.md) |
| `apps/cloud/` | the hosted cloud | [runbook](docs/runbooks/cloud.md) |
| `conformance/` | the SDK conformance lane: one generated fixture app per SDK and the suite they share | [conformance](conformance/AGENTS.md) |
| `e2e/` | every end-to-end lane, package `@zitadel/e2e` | [journey](e2e/journey/AGENTS.md), [console](e2e/console/AGENTS.md), [demo-next](e2e/demo-next/AGENTS.md), [demo-nuxt](e2e/demo-nuxt/AGENTS.md), [api-contract](e2e/api-contract/AGENTS.md) |
| `packages/` | SDKs (`sdk-*`), API client, config schemas | [packages](packages/AGENTS.md) |
| `packages/go/` | the Go API client module `go.zitadel.com/zitadel/v5`, generated with the server | [go](packages/go/AGENTS.md) |
| `packages/components/` | `<zl-*>` atoms, the `<zitadel-login>` orchestrator | [components](packages/components/AGENTS.md) |
| `packages/design-tokens/` | the `--zl-*` tokens both UIs share | [design-tokens](packages/design-tokens/AGENTS.md) |
| `packages/api-mock/` | mock API for demos and tests | [api-mock](packages/api-mock/AGENTS.md) |
| `packages/testing/` | `@zitadel/testing`, the published test kit | [testing](packages/testing/AGENTS.md) |
| `turbo.json` files, `scripts/` | task graph; scripts behind the root `package.json` | [turbo](docs/design/build/turborepo.md) |
| `docs/` | ADRs, design notes, runbooks | [ADR index](docs/adrs/README.md) |

## Workflow Front Doors

### I am contributing to Zitadel

| I want to...                       | Run                                           |
| ---------------------------------- | --------------------------------------------- |
| Put pnpm and turbo on PATH, once   | `corepack enable && npm install --global turbo` |
| Check my setup                     | `pnpm run doctor`                             |
| Try the local Zitadel CLI          | `pnpm run cli -- --help`                      |
| Preview the docs site              | `pnpm run docs`                               |
| Run the server from source         | `pnpm run server -- --help`                   |
| Test the fresh-app onboarding path | `turbo run journey --filter=@zitadel/e2e`     |
| Run normal local checks            | `turbo run lint typecheck build test`         |
| Check the API against its spec     | `turbo run api-contract --filter=@zitadel/e2e` |
| Run what CI runs                   | `pnpm run ci`                                 |
| Check a release or Changesets edit | `turbo run test pack --filter=@zitadel/release` |
| Rerun one failed task              | `turbo run <task> --filter=<package>`         |
| Check a PR title                   | `node scripts/check-pr-title.mjs --title "…"` |
| Run the hosted cloud locally       | `pnpm run cloud`                              |
| Check a deployment of the cloud    | `CLOUD_URL=<url> pnpm check:cloud`            |

The root scripts run from this checkout; the published `zitadel` commands
must run without it, Docker, Go or Turborepo
([CONTRIBUTING.md](CONTRIBUTING.md#testing-the-cli-from-source)).

### I am adding Zitadel to my app

Use the [README's command table](README.md#i-am-adding-zitadel-to-my-app); the
consumer-agent contract is the CLI's
[SKILL.md](apps/cli/skills/zitadel-cli/SKILL.md).

## Hard rules

- **Generated files**: never hand-edit generated output; change its source
  and regenerate (`turbo run generate --filter=@zitadel/server` for Go/OpenAPI).
  - `@zitadel/server#check-generate` (in `lint`) fails on drift and on
    generated files nothing generates any more.
  - Never let a task write a committed file during a run
    ([turborepo.md](docs/design/build/turborepo.md#tasks-that-write-files)).
  - Do not reintroduce a scheduler-side bootstrap pass for `go generate`;
    `apps/api/api/cmd/gen_openapi_errors` breaks the cycle itself.
  - Keep `mockgen` directives in the mock packages, not beside the interfaces.
- **Go modules**: every module in `go.work` compiles with what its own `go.mod`
  selects; after a `go.mod` change run `node scripts/check-go-work.mjs --fix`
  (the root's `check-go-work`).
- **Resource IDs**: never write ULID/UUID helpers; mint them as
  [storage](apps/api/internal/storage/AGENTS.md) says ([ADR 047](docs/adrs/047-dialect-id-generation.md)).
- **Wire casing**: fields, enum values and parameters are `snake_case`;
  the server's `lint` lints the spec ([openapi](apps/api/api/openapi/AGENTS.md)).
- **CLI contract**: keep `--json` output one parseable envelope on stdout;
  update [SKILL.md](apps/cli/skills/zitadel-cli/SKILL.md) with every behavior change.
- **UI surface**: decide whether a component is console or login UI before
  building it; never copy a flattened app mock ([styling](apps/console/docs/styling.md)).
  - Add or change a login atom by the [Storybook recipe](apps/storybook/AGENTS.md).
- **Login flow**: [default-login.json](packages/config/defaults/default-login.json)
  owns step shape; diff a mock fixture against it before changing the fixture.
- **Console**: develop it with `turbo run dev:real --filter=@zitadel/console`;
  list screens are only honest against real data ([console](apps/console/AGENTS.md)).
- **Testing layers**: test at the lowest layer that proves the property, and
  never duplicate upward ([testing](packages/testing/AGENTS.md)).
- **Turborepo** is the task runner; read [turborepo.md](docs/design/build/turborepo.md)
  before editing a `turbo.json`.
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
- E2E lanes: [testing](packages/testing/AGENTS.md);
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
