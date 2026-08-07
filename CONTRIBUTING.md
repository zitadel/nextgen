# Contributing

This repository contains a pre-release Zitadel preview. It is public for
visibility, feedback, and security reporting, but we are not yet accepting
external code contributions here unless a maintainer explicitly asks for one.
The workflows below are primarily for the Zitadel team and invited
contributors while the preview stabilizes.

If you want to add Zitadel to your own app rather than contribute here, see the
[quick-start guide in README.md](README.md).

## Prerequisites

- Go version from [`go.mod`](go.mod)
- Node.js from [`.nvmrc`](.nvmrc)
- pnpm 10 from [`package.json`](package.json) (`corepack enable`)
- [Moon](https://moonrepo.dev/moon)

### Using the devcontainer

The devcontainer at [.devcontainer/](.devcontainer/) pins Go 1.26. With no
database configured, the server uses SQLite under the server data directory
(same zero-config default as outside the container). After changing
devcontainer configuration, use **Dev Containers: Rebuild Container** so
features and volume mounts apply.

The devcontainer reuses the host Docker daemon (Docker-outside-of-Docker), so
container-backed workflows such as the
[database integration tests](#go-database-integration-tests) work inside it —
verify with `docker info`. If `docker info` fails and the host uses
**rootless Docker**, override the socket mount in
[`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json) per the
[docker-outside-of-docker feature docs](https://github.com/devcontainers/features/tree/main/src/docker-outside-of-docker#rootless-docker-support),
for example bind `/run/user/<uid>/docker.sock` to `/var/run/docker-host.sock`
(use `id -u` on the host for `<uid>`).

## I want to contribute to the backend

For changes to the Go server, APIs, or database layer.

| I want to...                                          | Run                                        |
| ----------------------------------------------------- | ------------------------------------------ |
| Install dependencies                                  | `corepack pnpm install --frozen-lockfile`  |
| Verify my toolchain                                   | `moon run workspace:doctor`                |
| Start the server (builds console + login-ui, then Go) | `moon run workspace:server`                |
| Start the server (skip UI builds)                     | `go run . server`                          |
| Debug and attach VSCode                               | `moon run workspace:server-debug`          |
| Regenerate Go/OpenAPI artifacts                       | `moon run server:generate`                 |
| Verify committed generated output                     | `moon run server:check-generate`           |
| Run lint, type checks, and tests                      | `moon ci :lint :typecheck :build :test`    |
| Preview planned Changesets bumps                      | `corepack pnpm exec changeset status --since origin/main` |

Run `corepack pnpm install --frozen-lockfile` first — Moon does not install
node_modules automatically (`.moon/workspace.yml` sets `installDependencies: false`).

### Starting the server from source

The Go binary embeds production builds of two frontend apps:
- `apps/console` → `internal/staticui/console/dist/`
- `apps/login-ui` → `internal/staticui/login/dist/`

`moon run workspace:server` builds both apps before starting Go. If you have not
changed any frontend code, skip the UI builds with `go run . server`.

To build the UIs manually (when bypassing the wrapper):

```sh
moon run console:build login-ui:build
go run . server
```

With no database configured, the server uses SQLite at
`<server.data_dir>/zitadel.db`. Override with `-c docs/operations/nextgen.example.yaml`,
`NEXTGEN_DATABASE_SQLITE`, or `NEXTGEN_DATABASE_POSTGRES` when you want a
path or DSN you manage.

Open http://localhost:8080/ui/console/ and http://localhost:8080/ui/login/

### Debugging with VSCode

Use `server-debug` to build the binary with debug symbols and disabled inlining,
then attach VSCode's Go debugger by PID:

```sh
moon run workspace:server-debug -- server --user-file examples/bootstrap-users/demo-admin.json
```

The task prints the exact `go build` invocation and the PID of the running process:

```
[server-debug] build: go build -gcflags 'all=-N -l' -ldflags '-X main.version=debug' -o dist/server/nextgen-debug .
[server-debug] run:   ./dist/server/nextgen-debug server --user-file examples/bootstrap-users/demo-admin.json

[server-debug] PID 98765 — VSCode: Run ▸ Start Debugging ▸ "Attach to Process"
```

In VSCode, open the **Run and Debug** panel (`⇧⌘D`), select **"Attach to Process"**, and type
`nextgen-debug` in the picker to filter.

Add the following configuration to your `.vscode/launch.json` to enable it:

```json
{
    "name": "Attach to Process",
    "type": "go",
    "request": "attach",
    "mode": "local",
    "processId": "${command:pickProcess}"
}
```

The debug binary stamps `version=debug` so it is distinguishable from a production
build (semver) and a plain `go run` build (`dev`).

### Testing the CLI from source

Contributors testing the published CLI flow against local workspace packages use
`moon run workspace:cli -- start` and `moon run workspace:cli -- setup --server local`
instead of `npx`. This requires the source repository to be checked out.

Before invoking the local CLI, the wrapper builds and packs the public workspace
packages, publishes them to a persistent local Verdaccio registry under
`tmp/cli-local-registry`, and points the generated app install at that registry.
Set `ZITADEL_CLI_USE_PUBLIC_PACKAGES=1` to install public npm packages in the
generated app instead of local ones.

Pass `--runtime docker`, `--image <tag>`, or set `ZITADEL_LOCAL_IMAGE=<tag>` when
intentionally testing the Docker backend.

---

## I want to contribute to the front-end embedded apps

For changes to the admin console (`apps/console`) or the login UI (`apps/login-ui`) —
the two SPAs bundled directly into the server binary.

| I want to...                                 | Run                                        |
| -------------------------------------------- | ------------------------------------------ |
| Install dependencies                         | `corepack pnpm install --frozen-lockfile`  |
| Verify my toolchain                          | `moon run workspace:doctor`                |
| Open the component workbench (Storybook)     | `moon run storybook:dev` → http://localhost:6006 |
| Start the console dev server                 | `moon run console:dev` → http://localhost:5174 |
| Start the login-UI dev server                | `moon run login-ui:dev` → http://localhost:5175 |
| Build both apps and test with the Go server  | `moon run console:build login-ui:build` then `go run . server` |
| Run lint, type checks, and tests             | `moon ci :lint :typecheck :build :test`    |

Run `corepack pnpm install --frozen-lockfile` first.

The console dev server uses in-browser API mocking, so you do not need a running
backend to iterate on the console. The login-UI dev server renders the real
sign-in flow instead; so you do need a running backend server to test the
authentication flows.

Dev servers serve at `/`; the embedded production builds are served at
`/ui/console/` and `/ui/login/`.

### First-run setup for the login-UI dev server

The Go backend does **not** create a project on startup. Create one before the
login UI can boot a flow. Project creation provisions the default human user
schema and default login/register flow definition.

**1. Start the API-only backend:**

```sh
NEXTGEN_SERVER_CONSOLE_ENABLED=false NEXTGEN_SERVER_LOGIN_ENABLED=false go run . server
```

This skips the embedded UI dist checks, so it works before you have built
`apps/console` or `apps/login-ui`.

**2. Create a project:**

```sh
curl -s -X POST http://localhost:8080/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "dev"}'
```

The response contains an `id` field — that is your project ID. If you have
`jq` installed, append `| jq .` to pretty-print the response.

**3. Configure the dev server:**

Copy the example env file and fill in your project ID:

```sh
cp apps/login-ui/.env.example apps/login-ui/.env.development.local
# edit .env.development.local and uncomment VITE_PROJECT_ID=<id-from-step-2>
```

These Vite env vars are only for the local dev server. `VITE_PROXY_PATH` tells
the login UI to prefix all API requests with
`/__nextgen`, which the Vite dev server proxies to the Go backend on port 8080.
Set `VITE_BACKEND_URL` in `.env.development.local` to override the target
(default: `http://localhost:8080`). Production hosted-login builds ignore these
development env vars and use request/URL-derived context instead.

As a one-off alternative, pass `?project_id=<id>` in the browser URL instead
of setting `VITE_PROJECT_ID`.

---

## Verifying your changes before pushing

Run the doctor once to verify your toolchain, then run the standard check suite
before opening a PR:

```sh
moon run workspace:doctor
moon ci :lint :typecheck :build :test
```

Docker is needed for container builds, Docker-fallback journeys, and
container-backed integration tests; it is not required for the default
npm-binary local runtime. Playwright browsers remain advisory for opt-in e2e and
journey workflows.

If you are new to Moon, start by listing the project graph and available tasks:

```sh
moon projects
moon tasks
moon project cli
moon task cli:test
```

Moon task targets use the `<project>:<task>` form, for example `moon run cli:test`.

Use `corepack pnpm exec changeset status --since origin/main` when you want to
preview the package bumps Changesets will plan from your PR. Pull requests also
get an informational Changesets comment; maintainers use that and the
[changeset decision table](.changeset/README.md#decision-table) to review release
intent.

Task runs are accelerated by Moon's remote cache, configured under `remote` in
[`.moon/workspace.yml`](.moon/workspace.yml); Depot CI runners authenticate
automatically. Local runs skip the remote cache unless you export a Depot API
token as `DEPOT_CACHE_TOKEN` — with one set, your machine downloads shared task
outputs but never uploads (uploads happen only in CI). Pull requests from forks
run on GitHub-hosted runners without the Depot cache credential.

To run the full CI-parity suite locally — including database integration
tests, package checks, and the fresh-app journey — run
`moon run workspace:check -- --full`. The demo end-to-end suites are not part
of `--full`; run them with `moon run workspace:check -- --only node:e2e` or
the Moon tasks below. To re-run a single failing task, use
`moon run <project>:<task>`. To re-run one check phase:
`moon run workspace:check -- --only <phase>`.

### What CI runs

Branch protection requires the GitHub Actions context `full-pr`, shown in the
pull request UI as `ci / full-pr` and defined in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). The job installs
dependencies, then picks one of two modes via `scripts/ci-mode.mjs`:

**Full mode** (normal PRs) runs, in order:

- `moon run server:check-generate` — Go generated-file drift check.
- Playwright Chromium install for `@zitadel/components`.
- `moon ci :lint :typecheck :build :test :test-browser :check-adrs`.
- `moon run server:test`, then `moon run server:test-postgres`,
  `moon run server:test-spanner` (Spanner emulator testcontainer), and
  `moon run server:test-sqlite`.
- `moon run release:snapshot -- --skip-container` — a non-publishing release
  snapshot.
- The fresh-app consumer journey (`cli-journey-e2e:e2e-local`) with the npm
  binary runtime against the snapshot's packed tarballs, one passkey-first
  preset journey run, and the test-kit consumer journey
  (`cli-journey-e2e:e2e-testkit`).
- The real-instance suites: `testing:test-integration` with
  `demo-next-e2e:e2e-real`, then `console-e2e:e2e-real`.

Within full mode, the steps after the `moon ci` graph are additionally gated
by moon's affected task selection (`moon query tasks --affected --downstream
deep`, computed in `scripts/ci-mode.mjs`): a lane is skipped when the diff
provably cannot reach its tasks — a docs-only PR runs almost nothing, a
frontend-only PR skips the Go suites. The gates fail open: known repo-wide
files no moon task claims (workflow definitions, `scripts/`, moon config,
root manifests and compiler/release inputs such as `tsconfig.base.json`), an
empty diff, or a failed query all force the complete run — and when the
query returns an empty affected set, the run is only skipped if every
changed file is on a narrow explicitly-inert allowlist (`docs/`, root agent
notes), because unclaimed files are not assumed inert. The journeys and the
snapshot share one gate because the tarball handoff between them is a
filesystem contract moon cannot see.

**Version-only mode** (Changesets version PRs) runs `release:version`,
`release:pack`, and tarball verification instead.

CI consumes the workflow's packed npm tarballs, not public Zitadel packages.
Changesets PR comments are informational release-intent feedback, not a
blocking gate. Workflow artifacts (the release snapshot always, journey
diagnostics on failure) expire after 7 days. The demo end-to-end suites and
the Docker-fallback journey do not run in CI; they stay opt-in local checks
(see below).

## Running integration and end-to-end tests

### Go database integration tests

SQLite integration tests use a local file database and need no Docker:

```sh
moon run server:test-sqlite
# or: go test -v -tags sqlite_integration -timeout=5m ./...
```

Postgres and Spanner integration tests use
[testcontainers](https://golang.testcontainers.org/) to start their databases
(a Postgres container and the Cloud Spanner **emulator** image), so a running
Docker daemon is required — see
[Using the devcontainer](#using-the-devcontainer) for the
Docker-outside-of-Docker setup. Local zero-config runs use SQLite and need no
Docker.

```sh
# Postgres (testcontainer, or ZITADEL_TEST_POSTGRES_URL)
moon run server:test-postgres
# or: go test -v -tags postgres_integration -timeout=10m ./...

# Spanner (prefer the Moon task — see emulator-testcontainer note below)
moon run server:test-spanner
```

To run the Postgres or Spanner suites against a database you manage instead of
testcontainers, set `ZITADEL_TEST_POSTGRES_URL` (Postgres DSN) or
`ZITADEL_TEST_SPANNER_URL` (Spanner DSN); those suites honor the env vars and
connect instead of starting a container, so `go test -tags … ./...` needs no
Docker. Point them at a throwaway database — the suites run migrations that
create the `zitadel_nextgen` schema.

The Spanner emulator only supports one transaction at a time, so concurrent
integration tests make it abort read-write transactions aggressively. That is
deliberate and useful: Spanner aborts under concurrency in production too, and
the emulator surfaces a missing retry immediately. The suite therefore runs at
full parallelism against the emulator, and `TestTransactionContention` asserts
that concurrent writers to one row all commit.

If you see a raw `ABORTED` ("aborted due to another transaction getting
priority"), do not serialize the tests and do not move them to a real instance —
both hide the bug. It means something on that code path stripped the gRPC status
off the error, so Spanner's `ReadWriteTransaction` stopped recognising it as
retryable. See the error-wrapping rules in
[internal/storage/v2/AGENTS.md](internal/storage/v2/AGENTS.md) and #788.

**On Apple Silicon, expect 7 pre-existing failures.** `emulator:latest` has a
native arm64 build, and it does not round commit timestamps the way the amd64
build CI runs does. Six subtests in `internal/storage/v2/stmttest` and
`TestJSONSchemaStatements_CRUD` compare a `created_at` read back after a second
statement and see tens of microseconds of drift. They are deterministic, they
are not caused by parallelism, and they pass in CI. Ignore them, or run the
emulator under `linux/amd64` emulation if you want a clean local run. If you
touch timestamp handling, verify on CI rather than trusting a local pass.

To run against a Spanner you manage instead of the emulator testcontainer, set
`ZITADEL_TEST_SPANNER_URL` to its DSN.

`ZITADEL_TEST_SPANNER_INSTANCE` (an instance path,
`projects/<project>/instances/<instance>`) still works and still provisions a
uniquely named database per run, dropping it afterwards, authenticating via
Application Default Credentials. Nothing sets it: CI is emulator-only on
purpose, and this path is kept only so the real instance can be brought back
quickly if the emulator turns out not to hold. Re-wiring is CI-side (restore the
Workload Identity Federation auth step and set the variable); the Go side needs
no change. Do not reach for it to make a failing test pass — that hides exactly
the aborts these suites exist to catch. Removal is tracked in #793.

### Demo end-to-end suites

These tests start real servers and require a browser install, so they are opt-in
locally. The demo suites exercise the checked-in framework demos:

```sh
corepack pnpm --filter @zitadel/demo-next-e2e exec playwright install
moon run demo-next-e2e:e2e
moon run demo-nuxt-e2e:e2e
```

### Fresh-app journey

The journey test creates one fresh app directory per selected framework outside
the repo, runs the full CLI setup flow against local workspace packages, starts
each generated app, and runs Playwright to verify the result. By default it runs
the full framework matrix; use `moon run workspace:journey -- --framework next`
for a single Next.js run:

```sh
moon run workspace:journey
```

To exercise the Docker fallback path, provide a local backend image tag:

```sh
moon run workspace:journey -- --runtime docker --image nextgen:local
```

Use `--keep` to preserve the temporary work directory after success. On failure
the runner keeps diagnostics automatically and prints the path.

## Building a release artifact

To build the versioned release binary (the same artifact published to GitHub
Releases):

```sh
moon run release:snapshot
```

The release task builds the embedded UI surfaces (console and login-ui)
automatically.

To cut or recover a release, follow the
[release runbook](docs/runbooks/manual-release.md). Moon builds the artifacts
and the draft GitHub Release; Changesets owns versions, npm publishing, and
release notes — see
[ADR 002](docs/adrs/002-multi-package-release-strategy.md) and
[`.changeset/README.md`](.changeset/README.md).

### Building a Docker image from source

By default, `moon run workspace:cli -- start` uses the npm binary runtime and
does not build a Docker image. To build and start a local Docker image instead,
pass `--runtime docker`:

```sh
moon run workspace:cli -- start --runtime docker
```

Use an existing image explicitly when you do not want to rebuild:

```sh
moon run workspace:cli -- start --runtime docker --image custom:tag
ZITADEL_LOCAL_IMAGE=custom:tag moon run workspace:cli -- start --runtime docker
```

## Project documentation and conventions

Before making a significant change, read the workspace conventions and any
relevant architecture decision records:

- [`AGENTS.md`](AGENTS.md) — workspace conventions
- [`docs/adrs/`](docs/adrs/) — architecture decisions

## Opening a pull request

### Title format

Use the conventional format `<type>(optional-scope): <summary>`. Allowed types
and scopes live in [`.github/semantic.yml`](.github/semantic.yml) — that file is
the source of truth for the lists, and CI rejects a title that does not match it.
Scopes are optional; omit the scope instead of inventing one.

#### Pick the type by audience, not by effort

The type is the first thing that decides whether a change reaches our release
notes, and those notes are read by people who want to use our SDKs and products
— not by people who work on this repo. A large, hard PR that only moves the
build graph is still `build`. Work through the ladder in order:

1. Can someone **using** Zitadel — the SDKs, the CLI, the API, the console — do
   something new because of this PR? → `feat`
2. Could that person have hit the broken behavior this PR corrects? → `fix`
3. Neither, but the change reaches shipped code (server, SDKs, CLI, console,
   login UI)? → `refactor` / `perf`
4. The change only touches this repo — CI, build wiring, tests, docs, scripts,
   tooling? → `ci` / `build` / `test` / `docs` / `chore`

Two invariants follow, and CI enforces the first:

- **Needs no changeset ⇒ not `feat`, not `fix`.** If nothing ships, it is not a
  customer feature or a customer bug fix. The
  [changeset decision table](.changeset/README.md#decision-table) answers this
  question already — the type follows from the same answer.
- **Changes what a user receives ⇒ not `docs`, not `chore`.** `docs` means
  documentation *in this repo*. Content generated into a customer's project, or
  shipped inside a package, is product.

The reverse of the first invariant does **not** hold: a changeset does not force
`feat` or `fix`. The Go server ships as one bundle, so an internal restructure
under `internal/` correctly carries a `@zitadel/server` changeset while staying
`refactor`.

What these got wrong, from this repo's own history:

| Shipped title | What it actually did | Should have been |
| --- | --- | --- |
| `feat: add withZitadel() Playwright orchestration to @zitadel/testing` (#680) | `@zitadel/testing` was journey-only and unpublished at the time (since #692 it ships on the release train, so kit API changes are `feat` today) | `test:` (then) |
| `feat: add Figma export sync pipeline for design tokens` (#494) | A sync script and a workflow; nothing in a release | `build:` |
| `chore: set argon2id as default password hashing algorithm` (#526) | Changed a shipped security default, with a `@zitadel/server` changeset | `feat:` |
| `docs(config): improve schema README guidance` (#482) | Rewrote a README that `@zitadel/config` generates into the user's project | `feat(config):` |

#### Write the summary for the reader

- Imperative present tense — `add`, not `added` or `implemented`.
- Name the surface the reader touches (`zitadel setup`, `<zitadel-login>`,
  `@zitadel/sdk-react`, the console), not the layer that changed. `feat: project
  storage` and `feat: add name to project domain model` name our internals;
  neither tells a reader what they can now do.
- Keep internal references — ADR numbers, PR numbers, file paths, "foundation",
  "POC" — in the description, not the title.

The same rules apply to the changeset summary, which matters more: that text is
rendered verbatim into `CHANGELOG.md` and the GitHub Release, while the title
never appears there. See [`.changeset/README.md`](.changeset/README.md#how-to-add-a-changeset).

Check a title before opening the PR:

```bash
node scripts/check-pr-title.mjs --title "fix(login): keep the passkey prompt after a failed attempt"
```

### Description

Include a concise PR description before handing work off for review. Use these
sections:

- `Summary` — what changed and why.
- `Validation` — exact commands run. If validation was not run, say so
  explicitly.
- `Release notes / changeset` — changeset status for user-visible package
  changes.
- `Notes` — reviewer context, follow-ups, risks, or `None`.
