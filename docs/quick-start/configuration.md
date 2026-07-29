# Configuration

The server loads settings from a YAML file, environment variables, or both. Environment variables use the `NEXTGEN_`
prefix and nested keys use underscores.

Example file: [`docs/operations/nextgen.example.yaml`](../operations/nextgen.example.yaml).

## Server

| YAML key                 | Environment                      | Default                                               | Description                                                                                             |
|--------------------------|----------------------------------|-------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `server.address`         | `NEXTGEN_SERVER_ADDRESS`         | `:8080`                                               | Listen address                                                                                          |
| `server.data_dir`        | `NEXTGEN_SERVER_DATA_DIR`        | `nextgen-data` next to the binary                     | Local runtime data root                                                                                 |
| `server.encryption_keys` | — (YAML only)                    | auto-generated RSA KEK under `<server.data_dir>/keks` | Root key-encryption keys (KEKs) that wrap data-encryption keys; see [Encryption keys](#encryption-keys) |
| `server.console_enabled` | `NEXTGEN_SERVER_CONSOLE_ENABLED` | `true`                                                | Serve embedded management console                                                                       |
| `server.console_path`    | `NEXTGEN_SERVER_CONSOLE_PATH`    | `/ui/console`                                         | Console URL prefix                                                                                      |
| `server.login_enabled`   | `NEXTGEN_SERVER_LOGIN_ENABLED`   | `true`                                                | Serve embedded login shell                                                                              |
| `server.login_path`      | `NEXTGEN_SERVER_LOGIN_PATH`      | `/ui/login`                                           | Login URL prefix                                                                                        |

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

## Encryption keys

The server wraps its data-encryption keys (DEKs) with one or more root key-encryption keys (KEKs), configured under
`server.encryption_keys`:

```yaml
server:
  encryption_keys:
    # Each key is keyed by its ID; the ID identifies which key wrapped a value.
    root-kek:
      use_for_encryption: true
      # RSA private key inline as PEM (incl. OpenSSH) or JWK ...
      private_key: |
        -----BEGIN PRIVATE KEY-----
        ...
        -----END PRIVATE KEY-----
      # ... or point at a file instead of inlining:
      # file: /etc/nextgen/keys/root-kek.pem
```

Exactly one key must be marked `use_for_encryption: true`.

For local development, leave `server.encryption_keys` unset and persist
`server.data_dir`: the server generates an RSA KEK at
`<server.data_dir>/keks/root-kek.pem` and reuses it on subsequent starts.

To rotate the KEK, add a new key marked `use_for_encryption: true` and keep the previous key (s) (as extra entries or as
files in the KEK directory) for decryption; existing DEKs are re-encrypted under the new KEK on the next start. For
shared or production deployments, provide the key material through managed secrets rather than committing it to source
control.

Files in `<server.data_dir>/keks/` are merged into `server.encryption_keys` on every start, even when the setting is
configured explicitly. A file whose name matches a config entry's ID replaces that entry outright, dropping an inline
`private_key` and `use_for_encryption` — so keep the KEK directory empty when you configure keys yourself, and never
name an entry after a file that could appear there.

For the full picture — the KEK/DEK envelope, key generation, the KEK-directory discovery rules, and the rotation
procedure — see [Encryption keys (KEK / DEK)](../operations/encryption-keys.md).
