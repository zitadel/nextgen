# Bootstrap users (demo / local dev)

Load pre-defined users when starting the Go server. Each JSON file describes one user with header metadata, EAV attributes, and a bcrypt password hash.

## Run

```sh
go run . server --migrate -c <your-config.yaml> \
  --user-file examples/bootstrap-users/demo-admin.json
```

Repeat `--user-file` for multiple users. If a user with the same `(project_id, id)` already exists, that file is skipped (idempotent restarts).

## Sample credentials

[`demo-admin.json`](demo-admin.json):

| Field | Value |
|-------|-------|
| Username (login) | `admin` |
| Password | `secret` |

The `encoded_hash` is bcrypt cost 10. Generate a new hash with any bcrypt tool; the server validates algorithm and cost against `password_hasher` in config.

## JSON shape

| Section | Purpose |
|---------|---------|
| `header` | `project_id`, `schema_url`, `id` (required); `team_id` (optional) |
| `attributes` | Flat map of scalar values (string, number, boolean) |
| `authenticators` | Only `password` with `encoded_hash` (no plaintext) |

Required attributes:

- `username` — stored with **global** uniqueness
- `zitadel.source` — must be `"cli"`
- `zitadel.default_user` — must be `true`

## Login flow note

Auth attempts resolve users by attribute name + value (e.g. `UserProof{AttributeName: "username", LoginName: "admin"}`). The flow definition used in your demo must collect **username** as the identifier field, not only email. Default scaffolded flows often use email; adjust the flow or add a username-based login flow for these users.
