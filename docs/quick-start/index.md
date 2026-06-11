# Quick start

Add Zitadel to a local Next.js app with the published CLI and a Docker-managed
local Zitadel runtime.

## Prerequisites

- Node.js 20 or newer for `npx`
- Docker Engine or a Docker-compatible runtime

## Steps

```sh
npx create-next-app@latest myapp
cd myapp

npx @zitadel/cli@preview doctor
npx @zitadel/cli@preview start
npx @zitadel/cli@preview setup --framework next --server local

npm install
npm run dev
```

Open:

```text
http://localhost:3000/login
```

The managed local Zitadel server listens on http://localhost:8080 by default.
The CLI stores runtime metadata in `.zitadel/local/runtime.json` and mounts
`.zitadel/local/nextgen-data` into the container. Stop preserves that data:

```sh
npx @zitadel/cli@preview stop
```

Delete it explicitly:

```sh
npx @zitadel/cli@preview reset --force
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
