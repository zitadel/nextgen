# Docker Compose quick start

The compose file lives at [`docs/operations/docker-compose.yaml`](../operations/docker-compose.yaml).

## Image

By default the stack pulls:

```text
ghcr.io/zitadel/nextgen:latest
```

Override the tag in `.env` (`NEXTGEN_IMAGE`) when pinning a release or CI snapshot.

If the image is not published yet, build locally — see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Services

| Service | Role |
| ------- | ---- |
| `postgres` | PostgreSQL 18 with database `nextgen` |
| `nextgen` | API + embedded `/ui/console/` and `/ui/login/` |

## Environment And Volumes

Copy [`env.example`](../operations/env.example) to `.env` in the same directory as the compose file.

The template exposes:

- `NEXTGEN_IMAGE` — server image tag, defaulting to `ghcr.io/zitadel/nextgen:latest`
- `NEXTGEN_PORT` — local HTTP port, defaulting to `8080`
- `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT` / `NEXTGEN_SERVER_PUBLIC_BASE` — optional, enables claiming projects on this deployment; see [Configuration → Platform](./configuration.md#platform)

The compose file sets `NEXTGEN_DATABASE_POSTGRES` for the bundled Postgres
container and persists server data under the `nextgen-server-data` volume. When
no master keys are configured, the server generates and reuses an RSA master
key under `master-keys/` in that mounted data directory. Losing that volume
makes every encrypted value unrecoverable; see
[Encryption keys (master key / project KEK)](../operations/encryption-keys.md).

## Bootstrap users

To load demo users on startup, uncomment the `user-file` volume and command override in the compose file, or run:

```sh
docker compose run --rm nextgen server \
  --user-file /bootstrap/demo-admin.json
```

See [`examples/bootstrap-users/`](../../examples/bootstrap-users/).

## Logs and teardown

```sh
docker compose logs -f nextgen
docker compose down
docker compose down -v   # also remove Postgres and server data volumes
```
