# Contributing

If you want to add Zitadel to your own app rather than contribute here, see the
[quick-start guide in README.md](README.md).

## Prerequisites

- Go version from [`go.mod`](go.mod)
- Node.js from [`.nvmrc`](.nvmrc)
- pnpm 10 from [`package.json`](package.json) (`corepack enable`)
- [Moon](https://moonrepo.dev/moon)

## I want to contribute to the backend

For changes to the Go server, APIs, or database layer.

| I want to...                                          | Run                                        |
| ----------------------------------------------------- | ------------------------------------------ |
| Install dependencies                                  | `corepack pnpm install --frozen-lockfile`  |
| Verify my toolchain                                   | `moon run workspace:doctor`                |
| Start the server (builds console + login-ui, then Go) | `moon run workspace:server`                |
| Start the server (skip UI builds)                     | `go run . server`                          |
| Debug and attach VSCode                               | `moon run workspace:server-debug`          |
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

With no database configured, the server starts embedded Postgres and stores its
data under the server data directory. Use `-c docs/operations/nextgen.example.yaml`
or `NEXTGEN_DATABASE_POSTGRES` when you want to point at a database you manage.

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
  -d '{}'
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

To run the full CI-parity suite locally — including integration tests, demo
end-to-end tests, and the fresh-app journey — run
`moon run workspace:check -- --full`. To re-run a single failing task, use
`moon run <project>:<task>`. To re-run one legacy check phase:
`moon run workspace:check -- --only <phase>`.

## Running integration and end-to-end tests

These tests start real servers and require a browser install, so they are opt-in
locally. The demo suites exercise the checked-in framework demos:

```sh
corepack pnpm --filter @zitadel/demo-next-e2e exec playwright install
moon run demo-next-e2e:e2e
moon run demo-nuxt-e2e:e2e
```

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

Pull request titles are checked by Semantic PR. Use the conventional format
`<type>(optional-scope): <summary>`.

Allowed types and scopes live in [`.github/semantic.yml`](.github/semantic.yml).
Scopes are optional; omit the scope instead of inventing one. For
documentation-only changes, use the `docs` type, for example:

```text
docs: add preview status disclaimer
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
