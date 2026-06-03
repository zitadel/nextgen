# Configuration

The server loads settings from a YAML file, environment variables, or both. Environment variables use the `NEXTGEN_` prefix and nested keys use underscores.

Example file: [`docs/operations/nextgen.example.yaml`](../operations/nextgen.example.yaml).

## Server

| YAML key | Environment | Default | Description |
| -------- | ----------- | ------- | ----------- |
| `server.address` | `NEXTGEN_SERVER_ADDRESS` | `:8080` | Listen address |
| `server.encryption_key` | `NEXTGEN_SERVER_ENCRYPTION_KEY` | *(required)* | 64-char hex (32 bytes) for sealing flow cookies |
| `server.console_enabled` | `NEXTGEN_SERVER_CONSOLE_ENABLED` | `true` | Serve embedded management console |
| `server.console_path` | `NEXTGEN_SERVER_CONSOLE_PATH` | `/ui/console` | Console URL prefix |
| `server.login_enabled` | `NEXTGEN_SERVER_LOGIN_ENABLED` | `true` | Serve embedded login shell |
| `server.login_path` | `NEXTGEN_SERVER_LOGIN_PATH` | `/ui/login` | Login URL prefix |

## Database

Configure exactly one dialect:

```yaml
database:
  postgres: postgres://zitadel:zitadel@localhost:5432/nextgen?sslmode=disable
```

Or via environment:

```sh
export NEXTGEN_DATABASE_POSTGRES='postgres://zitadel:zitadel@localhost:5432/nextgen?sslmode=disable'
```

Migrations run automatically when the server starts.

## Config file search paths

When `-c` is not passed, the server looks for `nextgen.yaml` in:

- `.`
- `./config`
- `/etc/nextgen`

## Dev-only cookie key

The example compose env file uses a fixed sealer key suitable for local development only. Generate a unique random 32-byte key for any shared or production deployment.
