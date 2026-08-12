# Quick start

Add Zitadel to a local Next.js app with the published CLI and a managed local
Zitadel runtime.

## Prerequisites

- Node.js 24 or newer for `npx`
- Docker Engine or a Docker-compatible runtime, only for the opt-in Docker
  fallback (`start --runtime docker`)

The default `start` runs the released `@zitadel/server` npm binary and does
not need Docker. With no database override it uses SQLite under the local
data directory. Remote-server setup can skip the local runtime entirely by
passing `--server <url>` instead of `--server local`.

## Steps

```sh
mkdir myapp
cd myapp

npx @zitadel/cli@alpha doctor
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --server local

npm run dev
```

Open the dev server URL printed by Next.js, then complete the browser proof:

```text
register a user -> log out -> log in with the same user -> profile shows Signed in
```

For deterministic automated proof from this repository, run
`corepack pnpm run journey`; it exercises fresh-app setup plus registration,
logout, and login across the supported frameworks.

The managed local Zitadel server listens on http://localhost:8080 by default.
The CLI stores runtime metadata in `.zitadel/local/runtime.json` and keeps the
server data under `.zitadel/local/` (SQLite at
`.zitadel/local/nextgen-data/zitadel.db` by default; the Docker fallback mounts
`.zitadel/local/nextgen-data` into the container). If you start from a fresh
directory, `setup --server local` walks through the scaffold choices (such as
which framework and use case) and writes the app into the current directory.
Stop preserves runtime data:

```sh
npx @zitadel/cli@alpha stop
```

Delete it explicitly:

```sh
npx @zitadel/cli@alpha reset --force
```

## Known Rough Edges

The alpha default registration form may ask for date of birth, and the profile
avatar may show a minimal `?` identity. These come from the current
server-owned default user schema and profile surface; they are not setup
failures.

## Local Runtime URLs

| Surface | URL |
| ------- | --- |
| API | http://localhost:8080 |
| Management console | http://localhost:8080/ui/console/ |
| Sign-in shell (`<zitadel-login>`) | http://localhost:8080/ui/login/ |
| Health check | http://localhost:8080/healthz |

## Manual Docker Compose

Use Docker Compose when you want to inspect the operator-style stack directly
or run Zitadel with a separate PostgreSQL container (Compose is Postgres-by-design;
for SQLite vs PostgreSQL vs Spanner, see [configuration.md](./configuration.md)):

- [docker-compose.md](./docker-compose.md) — image tags, volumes, bootstrap users
- [configuration.md](./configuration.md) — `nextgen.yaml` and environment variables
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md) — build the binary and image locally
