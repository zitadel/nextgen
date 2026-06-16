# Quick start

Add Zitadel to a local Next.js app with the published CLI and a Docker-managed
local Zitadel runtime.

## Prerequisites

- Node.js 20 or newer for `npx`
- Docker Engine or a Docker-compatible runtime

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

The managed local Zitadel server listens on http://localhost:8080 by default.
The CLI stores runtime metadata in `.zitadel/local/runtime.json` and mounts
`.zitadel/local/nextgen-data` into the container. If you start from a fresh
directory, `setup --server local` asks which framework to scaffold and writes
the app into the current directory. Stop preserves runtime data:

```sh
npx @zitadel/cli@alpha stop
```

Delete it explicitly:

```sh
npx @zitadel/cli@alpha reset --force
```

## Local Runtime URLs

| Surface | URL |
| ------- | --- |
| API | http://localhost:8080 |
| Management console | http://localhost:8080/ui/console/ |
| Sign-in shell (`<zitadel-login>`) | http://localhost:8080/ui/login/ |
| Health check | http://localhost:8080/healthz |

## Manual Docker Compose

Use Docker Compose when you want to inspect the operator-style stack directly
or run Zitadel with a separate PostgreSQL container:

- [docker-compose.md](./docker-compose.md) — image tags, volumes, bootstrap users
- [configuration.md](./configuration.md) — `nextgen.yaml` and environment variables
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md) — build the binary and image locally
