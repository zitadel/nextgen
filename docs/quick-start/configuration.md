# Configuration

The server loads settings from a YAML file, environment variables, or both. Environment variables use the `NEXTGEN_` prefix and nested keys use underscores.

Example file: [`docs/operations/nextgen.example.yaml`](../operations/nextgen.example.yaml).

## Server

| YAML key | Environment | Default | Description |
| -------- | ----------- | ------- | ----------- |
| `server.address` | `NEXTGEN_SERVER_ADDRESS` | `:8080` | Listen address |
| `server.data_dir` | `NEXTGEN_SERVER_DATA_DIR` | `nextgen-data` next to the binary | Local runtime data root |
| `server.encryption_key` | `NEXTGEN_SERVER_ENCRYPTION_KEY` | unset | Optional 64-char hex key for sealing flow cookies |
| `server.encryption_key_file` | `NEXTGEN_SERVER_ENCRYPTION_KEY_FILE` | `<server.data_dir>/server-encryption-key` | Generated/reused key file when `server.encryption_key` is unset |
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

## Local cookie key

For local development, leave `server.encryption_key` unset and persist
`server.data_dir`; the server creates and reuses `server-encryption-key`.
For shared or production deployments, provide managed secret material through
your deployment environment rather than committing it to source control.
