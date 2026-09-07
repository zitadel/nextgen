---
"@zitadel/server": minor
"@zitadel/api": minor
---

Variables and secrets are now manageable over the API. Four endpoints, all
scoped to a project by the usual `project_id` and addressing one of its
environments with an optional `environment_name`:

- `GET /variables` returns the variables entered at that owner, keyed by name.
- `PATCH /variables` enters or replaces variables there. Names absent from the
  body are untouched, so a partial body is a partial update rather than a
  truncation, and the body is applied whole or not at all.
- `GET /variables/{variable_name}` reads one name at that owner.
- `DELETE /variables/{variable_name}` removes what that owner entered.

The project level and each environment are separate owners, not a ladder:
nothing is inherited in either direction, so a name one owner holds reads as
`var.not_found` from another, and deleting it there leaves the original
standing.

A variable is written as a bare scalar — `{"RETRY_COUNT": 10}` — or, to state
secrecy, as `{"GITHUB_CLIENT_SECRET": {"value": "s3cr3t", "secret": true}}`.
The shorthand always means "not a secret", so a value can never become secret
by accident, and marking one always leaves a trace in the request.

**Secrets are write-only.** A read reports that a secret is held and nothing
more: `{"GITHUB_CLIENT_SECRET": {"secret": true}}`. The value stays usable
without being readable — a configuration document referencing
`${{ GITHUB_CLIENT_SECRET }}` still resolves against the decrypted value when
it is served.
