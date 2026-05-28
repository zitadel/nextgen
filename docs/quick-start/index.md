# Quick start

Run Zitadel nextgen with PostgreSQL using Docker Compose and a pre-built image from GitHub Container Registry.

## Prerequisites

- Docker Engine with Compose v2
- curl

## Steps

1. Fetch the compose and env templates from the `main` branch:

   ```sh
   mkdir -p nextgen_quickstart
   curl -fsSL https://raw.githubusercontent.com/zitadel/nextgen/main/docs/operations/docker-compose.yaml -o nextgen_quickstart/docker-compose.yaml
   curl -fsSL https://raw.githubusercontent.com/zitadel/nextgen/main/docs/operations/env.example -o nextgen_quickstart/env.example
   ```

2. Copy the example environment file and start the stack:

   ```sh
   cd nextgen_quickstart
   cp env.example .env
   docker compose up -d
   ```

3. Open the bundled UIs (same origin as the API):

   | Surface | URL |
   | ------- | --- |
   | Management console (scaffolding) | http://localhost:8080/ui/console/ |
   | Sign-in shell (`<zitadel-login>`) | http://localhost:8080/ui/login/ |
   | Health check | http://localhost:8080/healthz |

4. Optional: verify the API responds:

   ```sh
   curl -sS http://localhost:8080/healthz
   ```

## What happens on first start

The `server` process applies database **migrations automatically** when it connects to PostgreSQL. There is no separate migrate command.

## Sign-in expectations

The login page at `/ui/login/` loads the `<zitadel-login>` web component against the same-origin Flow API. End-to-end sign-in requires flow execution to be enabled on the server; until then the page proves packaging and UI wiring.

See [login-ui.md](./login-ui.md) for query parameters and limitations.

## Next steps

- [docker-compose.md](./docker-compose.md) — image tags, volumes, bootstrap users
- [configuration.md](./configuration.md) — `nextgen.yaml` and environment variables
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md) — build the binary and image locally
