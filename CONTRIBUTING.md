# Contributing

## Prerequisites

- Go version from [`go.mod`](go.mod)
- Node.js from [`.nvmrc`](.nvmrc)
- pnpm 10 from [`package.json`](package.json) (`corepack enable`)

## Local checks

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm nx run-many -t lint,typecheck,build,test

go vet ./...
go test ./...
```

Before `go test`, sync embedded UI assets (see below) or run the full sync script once.

## End-to-end checks

End-to-end checks are opt-in locally because they start real servers and need a
browser install. The demo suites exercise the checked-in framework demos:

```sh
corepack pnpm exec playwright install
corepack pnpm nx run-many -t e2e -p @zitadel-nextgen/demo-next-e2e,@zitadel-nextgen/demo-nuxt-e2e
```

The consumer journey suite reproduces the CI quality gate against a fresh
generated Next.js app:

```sh
corepack pnpm nx run @zitadel/cli-journey-e2e:e2e-local
```

The local runner needs Docker for Verdaccio, but by default it starts the
backend from source with embedded Postgres, so no local database container is
required. It builds and packs the local publishable packages with pnpm,
publishes them to the temporary registry, creates a Next.js app outside the
repo, runs CLI setup through npm, starts the generated app on localhost, and
runs Playwright with one worker.

For image parity with CI, provide a local backend image tag:

```sh
corepack pnpm nx run @zitadel/cli-journey-e2e:e2e-local -- --backend image --image nextgen:local
```

Use `--keep` to preserve the temporary work directory after success. On failure
the runner keeps diagnostics automatically and prints the path.

## Run the server from source

### 1. Build frontends and sync embed directories

The Go binary embeds production builds from `internal/staticui/console/dist` and `internal/staticui/login/dist`:

```sh
sh scripts/sync-embedded-ui-dist.sh all
```

This runs `pnpm nx build` for `@zitadel/console` and `@zitadel/login-ui`, then `cp -r` into the internal embed folders.

### 2. Configure and start

```sh
export NEXTGEN_SERVER_ENCRYPTION_KEY=4D61737465726B65794E65656473546F48617665333243686172616374657273
export NEXTGEN_DATABASE_POSTGRES='postgres://zitadel:zitadel@localhost:5432/nextgen?sslmode=disable'

go run . server -c docs/operations/nextgen.example.yaml
```

Open http://localhost:8080/ui/console/ and http://localhost:8080/ui/login/

### Frontends only (without Go)

```sh
corepack pnpm nx dev @zitadel/console   # http://localhost:5174
corepack pnpm nx dev @zitadel/login-ui  # http://localhost:5175
```

Dev servers use `/` as the Vite base; production embeds use `/ui/console/` and `/ui/login/`.

## GoReleaser snapshot

```sh
goreleaser release --snapshot --clean --skip=publish,sign
```

The `before` hook runs `scripts/sync-embedded-ui-dist.sh` automatically.

### Local Docker image from snapshot

After a snapshot build, binaries are under `dist/`:

```sh
docker build -t nextgen:local .
docker run --rm -p 8080:8080 \
  -e NEXTGEN_SERVER_ENCRYPTION_KEY=4D61737465726B65794E65656473546F48617665333243686172616374657273 \
  -e NEXTGEN_DATABASE_POSTGRES='postgres://...' \
  nextgen:local server
```

Place the platform binary at `linux/amd64/nextgen` in the build context when mimicking Goreleaser layout, or build with `go build -o nextgen .` and adjust the Dockerfile for local iteration.

## Agent and architecture docs

- [`AGENTS.md`](AGENTS.md) — workspace conventions
- [`docs/adrs/`](docs/adrs/) — architecture decisions
