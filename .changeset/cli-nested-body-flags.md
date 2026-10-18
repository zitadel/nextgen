---
"@zitadel/cli": minor
---

The resource commands now take every field of a body as a flag, nested ones included: a nested field's flag is its path joined with `-`. `zitadel idps create` takes `--slug`, `--display-name`, `--oidc-issuer`, `--oidc-client-id`, `--oidc-client-secret` and `--oidc-scopes` instead of only a JSON document. `zitadel grants create` names its principal with `--user-identifier` or `--team-name`, and `zitadel projects update` sets the password hashing method with `--password-hash-algorithm` and `--password-hash-params-*`. A boolean takes `--no-<flag>` for `false`, and a list is a repeated flag. `--set <path>=<value>` (or `<path>:=<json>`) sets any field by its dot path, and `=` reads the value as the type the field has, so `--set oidc.pkce_enabled=false` is a boolean. `zitadel idps create --file` and `--data` take the connection document itself, the same shape as `.zitadel/idps/<slug>.json`; a body still wrapped in `idp` is accepted too.

- A field flag over `--file` or `--data` now changes only the key it names: `--attributes givenName=Ada` on top of a file no longer drops the file's other attributes.
- A `${{ NAME }}` variable reference is no longer refused as a credential, so `zitadel idps create --data` works. Booleans, enum values, declared numbers and endpoint URLs such as `token_endpoint` are no longer refused or redacted either. Free-form text in a field named like a credential is still refused, now also from the field flags and `--set`; write references in single quotes so the shell leaves `${{` alone.
- `--dry-run` shows those values instead of `«redacted»`, so the `body` it prints can be saved and sent later with `--file`.
- `zitadel resources --json` lists every nested field with its dot path, flag, kind and whether it is required.
