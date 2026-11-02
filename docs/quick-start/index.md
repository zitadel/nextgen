# Quick start

Add Zitadel to a local Next.js app with the published CLI and a managed local
Zitadel runtime.

## Prerequisites

- Node.js 24 or newer for `npx`
- Docker Engine or a Docker-compatible runtime, only for the opt-in Docker
  fallback (`start --runtime docker`)

The default `start` runs the released `@zitadel/server` npm binary and does
not need Docker. With no database override it uses SQLite. Remote-server setup
can skip the local runtime entirely by passing `--server <url>` instead of
`--server local`.

## Steps

```sh
mkdir myapp
cd myapp

npx @zitadel/cli@latest doctor
npx @zitadel/cli@latest start
npx @zitadel/cli@latest setup --server local

npm run dev
```

`start` also creates a local admin, `admin@zitadel.localhost`, and ends by
printing a one-time sign-in link for the management console. `setup --server
local` by default attaches the new project to that admin's team and prints
`Project owned by admin@zitadel.localhost (team ...)`, so the project is
already owned and `zitadel claim` has nothing to do.

Open the dev server URL printed by Next.js, then complete the browser proof:

```text
register a user -> log out -> log in with the same user -> profile shows Signed in
```

For deterministic automated proof from this repository, run
`moon run e2e:journey`; it exercises fresh-app setup plus registration,
logout, and login across the supported frameworks.

The managed local Zitadel server listens on http://localhost:8080 for the first directory you start. Each directory runs its own server, so the next one gets 8081 and so on, and `start` prints the URLs.
The CLI stores runtime metadata in `.zitadel/local/runtime.json` and keeps the
server data under `.zitadel/local/` (SQLite by default; the Docker fallback
mounts `.zitadel/local/nextgen-data` into the container). If you start from a fresh
directory, `setup --server local` walks through the scaffold choices (such as
which framework and use case) and writes the app into the current directory.
Stop preserves runtime data:

```sh
npx @zitadel/cli@latest stop
```

Delete it explicitly:

```sh
npx @zitadel/cli@latest reset --force
```

## Known Rough Edges

The preview's default registration form may ask for date of birth, and the profile
avatar may show a minimal `?` identity. These come from the current
server-owned default user schema and profile surface; they are not setup
failures.

Open the app at exactly `http://localhost:<port>` (not `127.0.0.1` or the
Next.js Network URL). Preview origins are exact-match, and WebAuthn RP IDs
are hostname-based, so those spellings are not interchangeable.

## Local Runtime URLs

The table shows port 8080; use the port `zitadel start` printed if your directory got another.

| Surface | URL |
| ------- | --- |
| API | http://localhost:8080/api/v1 |
| Management console | http://localhost:8080/ui/console/ |
| Liveness probe | http://localhost:8080/livez |
| Readiness probe (checks the database) | http://localhost:8080/readyz |

Sign in with `npx @zitadel/cli@latest console`; the bare console URL asks for a
password that is never printed.

## Manual Docker Compose

Use Docker Compose when you want to inspect the operator-style stack directly
or run Zitadel with a separate PostgreSQL container:

- [docker-compose.md](./docker-compose.md) — image tags, volumes, bootstrap users
- [configuration.md](./configuration.md) — `nextgen.yaml`, dialects (SQLite / PostgreSQL / Spanner), and environment variables
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md) — build the binary and image locally
