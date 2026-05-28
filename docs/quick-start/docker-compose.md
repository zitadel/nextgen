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

## Environment

Copy [`env.example`](../operations/env.example) to `.env` in the same directory as the compose file.

Required variables:

- `NEXTGEN_DATABASE_POSTGRES` — connection URL (set in compose for the bundled Postgres)
- `NEXTGEN_SERVER_COOKIE_SEALER_KEY` — 32-byte hex key for flow cookies (**dev example only**)

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
docker compose down -v   # also remove the Postgres volume
```
