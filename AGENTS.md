# Agent Instructions

These instructions apply to the whole repository. A nearer `AGENTS.md` may add
more specific rules for a subtree.

## Instruction Scope And Precedence

Use `AGENTS.md` as the primary and tool-agnostic instruction source.

Always resolve instructions in this order:

1. Root `AGENTS.md` (this file)
2. The nearest scoped `AGENTS.md` for the files you read or change

If instructions conflict, the nearest scoped `AGENTS.md` for the touched path
takes precedence over broader scope files.

## ADR Context

Before changing behavior, review relevant ADRs in `docs/adrs/` and align
proposals and implementations with recorded decisions.

- `docs/adrs/004-agent-contract-and-agents-md.md` defines how external agents
  should consume the Zitadel CLI contract; treat it as product-surface context,
  not as the primary implementation contract for developing this repository.
- `docs/adrs/` contains product and architectural decisions that should be
  treated as implementation context, not optional references.

## Project Shape

This repo is the pre-release next generation of Zitadel. Moon owns the
monorepo task graph, release artifact builds, and the draft GitHub Release
shell; Changesets owns package versions, changelogs, npm publishing, and
public package tags (see "Release, Licensing, And Secrets"). This section
maps roles, not an exhaustive inventory — the authoritative project list is
`moon projects`, and workspace globs live in `pnpm-workspace.yaml`.

Go server:

- `main.go` + `cmd/` — Go entrypoint and command wiring.
- `internal/` — Go server implementation. `internal/api/` owns the HTTP
  handlers, `internal/service/` the service layer, `internal/domain/` the
  domain model and error sentinels, `internal/storage/` the multi-dialect
  storage layer (see [internal/storage/AGENTS.md](internal/storage/AGENTS.md)),
  `internal/authz/` the authorization subsystem (OpenFGA parser, profile
  validator, compiler — ADRs 032–034), and `internal/staticui/` serves the
  embedded UI builds.
- `api/openapi/` — OpenAPI 3.1 source files; wire rules in
  [api/openapi/AGENTS.md](api/openapi/AGENTS.md). `api/generated/` is ogen
  output; edit the OpenAPI source instead.

Product surfaces (`apps/`):

- `apps/cli/` — the `zitadel` npm CLI. `apps/cli/SKILLS.md` is the canonical
  consumer-agent contract.
- `apps/server/` + `apps/server-*/` — the `@zitadel/server` npm binary
  wrapper and its per-platform binary packages (one per OS/arch).
- `apps/console/` and `apps/login-ui/` — the two SPAs embedded into the Go
  server at `/ui/console/` and `/ui/login/`.
- `apps/docs/` — the Fumapress/Fumadocs documentation site.

Development and test surfaces (`apps/`):

- `apps/storybook/` — the single component workbench for the shared UI
  packages.
- `apps/demo-next/` and `apps/demo-nuxt/` — reference integrations of the
  embedded sign-in component on each framework.
- `apps/*-e2e/` — Playwright projects: one per demo (real framework
  middleware against the api-mock server), `console-e2e/` for the console,
  and `cli-journey-e2e/` for the fresh consumer journey (CLI setup plus real
  registration/login flows, installing local package tarballs through a
  temporary registry).
- `apps/mock-zitadel/` — thin deployment wrapper that serves
  `packages/api-mock` as a live per-PR preview endpoint.

Published libraries (`packages/`):

- `packages/sdk-*` — public TypeScript SDKs: `sdk-core` plus one package per
  supported framework (currently next, nuxt, react, vue, angular, qwik,
  solid, svelte).
- `packages/components/` (shared Lit atoms), `packages/ui-react/` (paired
  React implementations), `packages/design-tokens/` and
  `packages/shared-component-styles/` (shared visual design).
- `packages/api/` — generated TypeScript API client.
- `packages/config/` — versioned local config schemas and defaults.
- `packages/api-mock/` — in-process MSW handlers and the standalone mock
  auth server used by demos and e2e tests (defaults to port 8080; set
  `PORT` to override).

Repo tooling:

- `tools/release/` — the Moon `release` project (snapshot, artifacts, draft
  GitHub Release shell).
- `scripts/` — the Node `.mjs` orchestration behind the `workspace:*` tasks
  (doctor, check, journey, server, cli, release helpers).
- `docs/` — design notes, runbooks, and ADRs that explain product intent.

## Workflow Front Doors

### I am contributing to Zitadel

| I want to...                       | Run                                      |
| ---------------------------------- | ---------------------------------------- |
| Check my setup                     | `moon run workspace:doctor`              |
| Try the local Zitadel CLI          | `moon run workspace:cli -- --help`       |
| Preview the docs site              | `moon run docs:dev`                      |
| Run the server from source         | `moon run workspace:server -- --help`    |
| Test the fresh-app onboarding path | `moon run workspace:journey`             |
| Run normal local checks            | `moon ci :lint :typecheck :build :test`  |
| Mirror CI locally                  | `moon run workspace:check -- --full`     |
| Rerun one failed task              | `moon run <project>:<task>`              |

### I am adding Zitadel to my app

The consumer command table lives in
[README.md](README.md#i-am-adding-zitadel-to-my-app); the canonical
consumer-agent contract is [apps/cli/SKILLS.md](apps/cli/SKILLS.md).

### Contributor commands vs product commands

`moon run workspace:server` is a repository contributor command that runs the Go
server from source. `zitadel start` is a published product CLI command that
runs the released `@zitadel/server` npm binary for app developers and agents;
it must not rely on Docker, Go, Moon, or this source checkout. Docker remains
available through `zitadel start --runtime docker`.

`moon run workspace:cli -- start` and `moon run workspace:cli -- setup ...` are
the contributor exceptions: the root wrapper builds and packs the workspace
packages into a local Verdaccio registry so the CLI and generated apps run
against local `@zitadel/*` tarballs instead of public npm (details in
[CONTRIBUTING.md](CONTRIBUTING.md#testing-the-cli-from-source)). Set
`ZITADEL_CLI_USE_PUBLIC_PACKAGES=1` only when intentionally testing published
packages; pass `--runtime docker`, `--image`, or `ZITADEL_LOCAL_IMAGE` when
intentionally testing the Docker backend. Invoking `apps/cli/bin/run.js`
directly runs the last-built `dist/` — in a fresh checkout or after source
changes, run `pnpm install` and `moon run cli:build` first (the wrapper above
does this for you).

## Local Checks

Use Node.js from `.nvmrc` and the pinned pnpm version from `package.json`.

```sh
moon run workspace:doctor
moon ci :lint :typecheck :build :test
```

The root doctor treats Moon and the local toolchain as required. Docker is
needed for container builds, Docker fallback journeys, and container-backed
integration tests; it is not required for the default npm-binary local runtime.
Playwright browsers remain warning-only because they are needed only for opt-in
e2e and journey workflows.

Use `moon run workspace:check -- --full` for slower CI-parity phases and
`moon run <project>:<task>` to rerun one named task.
Use `moon run workspace:check -- --only release` after touching Changesets,
Moon release workflows, or package versioning behavior.

Prefer Moon project tasks for narrow package work, for example
`moon run cli:test`.

Moon manages TypeScript workspace targets, Go checks, and release build tasks.
Long-running customer-style local orchestration still runs through repository
scripts so server processes are signaled and cleaned up directly.

`moon run workspace:server` builds the embedded console/login UI before non-help
startup, then runs `go run .`. Direct `go run .` callers must build the embedded
UI surfaces themselves or disable both embedded UI surfaces.

Checked-in demo end-to-end tests are **opt-in for local runs** — they are not
part of the default `moon ci :lint :typecheck :build :test` invocation because
they boot real dev servers and need browsers installed. CI does run them: the
real-instance lanes carry `runInCI: false` only to keep them out of moon's
automatic selection, and the `full-pr` job runs them through explicit workflow
steps — the canonical statement of that interaction is in
[packages/testing/AGENTS.md](packages/testing/AGENTS.md). (More in
[CONTRIBUTING.md](CONTRIBUTING.md#running-integration-and-end-to-end-tests)):

```sh
corepack pnpm --filter @zitadel/demo-next-e2e exec playwright install
moon run demo-next-e2e:e2e
moon run demo-nuxt-e2e:e2e
```

The local reproduction command for the fresh-app consumer journey gate is:

```sh
moon run workspace:journey
```

It proves the fresh-app path end to end and does not require Docker by
default; use `-- --framework next` to run one framework and
`-- --runtime docker --image <docker-tag>` to exercise the Docker fallback
(details in [CONTRIBUTING.md](CONTRIBUTING.md#fresh-app-journey)). Use it for
deterministic CI-style proof of the fresh-app path, and
`moon run workspace:cli -- ...` for manual browser or agent experiments
against the same local package train.

In CI the branch-protection check is the GitHub Actions context `full-pr`,
shown in the pull request UI as `ci / full-pr`; it consumes the workflow's
packed npm tarballs instead of public Zitadel packages. Changesets PR comments
are informational release-intent feedback and are not branch-protection
requirements. Mirror the gate locally with
`moon run workspace:check -- --full`; the full step list is in
[CONTRIBUTING.md](CONTRIBUTING.md#what-ci-runs).

### Interactive demo verification

To test the sign-in flow interactively against the mock backend (two
terminals):

1. Start the mock auth server: `moon run api-mock:start` (port 8080)
2. Start demo-next: `moon run demo-next:dev` (port 3002), or demo-nuxt:
   `moon run demo-nuxt:dev` (port 3001)

The demos default to `ZITADEL_URL=http://localhost:8080`, matching the mock's
default port. If port 8080 is taken (for example by the Go server), start the
mock with `PORT=4000 moon run api-mock:start` and export
`ZITADEL_URL=http://localhost:4000` for the demo. See
`apps/demo-next/README.md` and `apps/demo-nuxt/README.md` for environment
details.

## Testing Layers

Pick the lowest layer that can prove the property and **do not duplicate
upward**. When deciding where a new test belongs:

1. **Unit (Vitest, `jsdom`)** — markup, props, ARIA, slot projection,
   event-contract shape, pure logic. Fastest; covers the bulk of behaviour.
2. **Browser (Vitest, real Chromium via `@vitest/browser-playwright`)** —
   form-association, focus delegation, Enter-to-submit, anything that
   needs a real `ElementInternals` or `HTMLFormElement`. Lives in
   `*.browser.spec.ts`.
3. **End-to-end (Playwright)** — full HTTP path through framework
   middleware, the `/__nextgen` proxy, real `Set-Cookie` round-trip,
   and full-page navigation. Owned by the `apps/*-e2e/` projects: the demo
   projects (`demo-next-e2e`, `demo-nuxt-e2e` — each with a mock lane and,
   for next, an `e2e-real` lane on `@zitadel/testing`), `console-e2e`
   (mock + real lanes), and `cli-journey-e2e` (the framework matrix across
   all 8 SDKs). Middleware-owning SDKs get their own e2e project because
   the proxy and route-protection layers are framework-specific.

The consumer journey suite is the exception to the checked-in demo ownership
rule: it belongs in `apps/cli-journey-e2e/` and must exercise a freshly
generated app because it protects the customer local setup path.

A new test belongs at e2e level only when the boundary it covers is
exclusively the framework integration (middleware, cookie origin, full
navigation). Component, atom, and orchestrator behaviour stays in
Vitest.

E2E tasks depend on the relevant build tasks, so the components `dist/` is rebuilt
automatically before each run — be aware of this when iterating with a
long-running dev server: stale `dist/` will silently mask orchestrator
changes.

## Building UI (console and design system)

Console screens and shared UI are driven by the Figma **Design System** file
(`Zitadel - Design System - External`), not by flattened app mocks. Before
building any UI under `apps/console/**` or
`packages/{components,ui-react,shared-component-styles,design-tokens}/**`,
**classify the component first** (see
[`apps/console/docs/styling.md`](apps/console/docs/styling.md)):

1. **Existing pair** (`Button`, `Card`, `Pill`, `Icon`, `TextField`, `Select`,
   `Checkbox`, `Alert`, `PageShell` — the registry is
   [`packages/shared-component-styles/pairs.json`](packages/shared-component-styles/pairs.json)) —
   compose it from `@zitadel/ui-react`.
2. **Console-only chrome** (shell, page layout, tables, app widgets) — build in
   `apps/console` with the **unprefixed shadcn utility contract**
   (`bg-background`, `text-muted-foreground`, …) from
   `@zitadel/design-tokens/css/shadcn.css`. Do **not** use `bg-zl-*`/`text-zl-*`
   utilities there — the canonical statement of this console exception is in
   [`packages/design-tokens/AGENTS.md`](packages/design-tokens/AGENTS.md).
   Most console UI is this; do not pre-build a Lit twin for it.
3. **A new primitive the login / web-component surface also needs** — build it
   as a Lit + React pair via the Storybook recipe
   ([`apps/storybook/AGENTS.md`](apps/storybook/AGENTS.md)) and iterate there
   behind the parity + a11y gates, not on a console mock.

The pairs are theme-portable: legacy tokens are authored as `{ dark, light }`
pairs and flip via `[data-theme="light"]` (amended ADR 014 §5), and the pairs'
surface CSS consumes mode-aware semantic tokens. When adding surface CSS,
never reach for the raw `--zl-color-gray-*` ramp — it is mode-independent by
design; use the semantic tokens. The canonical statement of that invariant is
in [`packages/shared-component-styles/AGENTS.md`](packages/shared-component-styles/AGENTS.md).

Where the component lives decides the iteration tool: console-local UI iterates
on the console dev server, verified at light/dark and each breakpoint; pairs
iterate in Storybook. A missing visual value is a **new token** in
`@zitadel/design-tokens`, never a magic value — except licensed brand assets
(e.g. display fonts), which stay in the consuming app because
`@zitadel/design-tokens` ships as a public npm package.

## Resource identifiers

Resource primary keys are dialect-owned `prefix_<opaque>` strings
([ADR 047](docs/adrs/047-dialect-id-generation.md)). Never add custom
ULID/UUID generation in domain, service, API, or other packages. The canonical
minting contract (`Ensure` / `NewManagedID`, the `idgen` boundary) lives in
[`internal/storage/AGENTS.md`](internal/storage/AGENTS.md).

## Generated Files

- Do not hand-edit `api/generated/**`; update `api/openapi/**` and run
  `moon run server:generate` or `go generate ./...`. CI enforces committed
  generated output through `server:check-generate` (via `server:test`).
  Wire fields are `snake_case`, enforced by the redocly rules and
  `workspace:check-openapi-rules` — the wire contract rules live in
  [api/openapi/AGENTS.md](api/openapi/AGENTS.md).
- Do not hand-edit generated package output under `dist/`.
- Do not hand-edit `apps/console/src/routeTree.gen.ts`; update route files and
  let the TanStack Router plugin regenerate it.
- Keep `apps/cli/SKILLS.md` aligned with the current CLI command surface and
  agent contract when CLI behavior changes.

## CLI Contract

The CLI is an agent-facing product surface;
[apps/cli/SKILLS.md](apps/cli/SKILLS.md) is the canonical agent-facing
reference for consuming it. Preserve the JSON envelope contract:
`--json` output must be parseable JSON on stdout, include top-level
`cli_version`, `command`, `source`, and `status`, and avoid stray stdout text.
Agent scripts should pass `--non-interactive --json` and prefer structured
`next_commands` over prose hints. When invoking the local root wrapper for JSON
capture, use `corepack pnpm --silent run cli -- ... --json`; plain `pnpm run`
prints its own script prelude before the CLI output.

For customer-local runtime workflows, agents should prefer
`zitadel doctor`, `zitadel start`, and `--server local` before running
`zitadel setup`.

## Release, Licensing, And Secrets

- PR titles use `<type>(optional-scope): <summary>`, with
  [`.github/semantic.yml`](.github/semantic.yml) as the source of truth for
  allowed types and scopes. Omit the scope when unsure; do not invent scopes.
- Pick the type by **who the change reaches, not how much work it was**. If the
  change needs no changeset it is not `feat` or `fix`; if it changes what a user
  receives it is not `docs` or `chore`. CI enforces the first of those. Ladder,
  worked examples, and summary voice:
  [CONTRIBUTING.md](CONTRIBUTING.md#title-format). Self-check before opening:
  `node scripts/check-pr-title.mjs --title "<title>"`.
- Agent-created or agent-updated PRs must include a concise description with
  `Summary`, `Validation`, `Release notes / changeset`, and `Notes` sections
  before handoff. In **Release notes / changeset**, state the outcome from
  the [decision table](.changeset/README.md#decision-table). Full conventions:
  [CONTRIBUTING.md](CONTRIBUTING.md#opening-a-pull-request).

### Changesets

The changeset decision — including when a Go-only change needs one — lives in
[`.changeset/README.md`](.changeset/README.md); follow its
[decision table](.changeset/README.md#decision-table). Agents write the
`.changeset/*.md` file directly rather than using the interactive prompt, then
verify with `corepack pnpm exec changeset status --since origin/main`.

- npm packages under `apps/cli/` and `packages/*` must stay MIT-licensed.
- Server npm packages under `apps/server/` and `apps/server-*/` and console
  application paths are AGPL-3.0-only by default.
- Keep local secrets, private keys, tokens, and `.zitadel/secret`-style files out
  of source control and browser-safe runtime metadata.

## General Guidelines for working with Moon

- Use Moon as the task front door for workspace build graph work:
  `moon ci`, `moon run <project>:<task>`, and release tasks under
  `moon run release:*`.
- Keep direct underlying tools for implementation details: `vite`, `vitest`,
  `tsc`, `playwright`, `oxlint`, `go`, `docker buildx`, and `changeset`.
- Do not reintroduce Nx or GoReleaser without updating the ADRs first.
- When unsure about Moon flags, check `moon --help` or the task definition in
  the nearest `moon.yml` before guessing.

## Ephemeral Development Environments

Fresh cloud-agent VMs and containers commonly hit the following; none of it
is tool-specific.

### Node.js version

The repo requires the Node.js version from `.nvmrc`; sandbox images often
ship an older default. Ensure the `.nvmrc` version is first on `$PATH` (for
example via nvm) before running any `corepack` or `pnpm` command.

### Playwright browser install gotcha

The standard `playwright install --with-deps chromium` may hang during zip
extraction in minimal VMs. If that happens, download and extract manually:

```sh
curl -fsSL -o /tmp/chrome-linux64.zip \
  "https://cdn.playwright.dev/builds/cft/<version>/linux64/chrome-linux64.zip"
mkdir -p ~/.cache/ms-playwright/chromium-<rev>
unzip -q /tmp/chrome-linux64.zip -d ~/.cache/ms-playwright/chromium-<rev>
```

Repeat for `chrome-headless-shell-linux64.zip` into `chromium_headless_shell-<rev>`.
Look up `<version>` (browserVersion) and `<rev>` (revision) in the installed
package's `browsers.json` at
`node_modules/.pnpm/playwright-core@<pkg>/node_modules/playwright-core/browsers.json`.

### Stale Nuxt lock files

If a Nuxt e2e test or dev server was killed ungracefully, a stale lock file at
`apps/demo-nuxt/.nuxt/dev/.lock` may block the next startup. Remove it and
the `.nuxt` directory if you see "Another Nuxt dev server is already running".
