---
"@zitadel/server": minor
"@zitadel/api": minor
---

Configuration values can now be stored as variables on a project, and managed over the API.

A variable belongs to a project. A configuration document references one as `${{ NAME }}`, and the value the project entered is substituted in. A reference that is the whole field keeps the value's type, so `"${{ RETRY_COUNT }}"` resolves to `10` rather than `"10"`; a reference inside a longer string is rendered into it, so `"https://${{ HOST }}/callback"` resolves to a URL; and a reference nothing was entered for is left as it stands. A variable marked secret is encrypted with the project's own key and stays readable after that key is rotated.

Four endpoints, all scoped to a project by the usual `project_id`:

- `GET /variables` returns the variables entered on the project, keyed by name.
- `PATCH /variables` enters or replaces variables there. Names absent from the body are untouched, so a partial body is a partial update rather than a truncation, and the body is applied whole or not at all.
- `GET /variables/{variable_name}` reads one name.
- `DELETE /variables/{variable_name}` removes it.

A variable is written as a bare scalar — `{"RETRY_COUNT": 10}` — or, to state secrecy, as `{"GITHUB_CLIENT_SECRET": {"value": "s3cr3t", "secret": true}}`. The shorthand always means "not a secret", so a value can never become secret by accident, and marking one always leaves a trace in the request.

**Secrets are write-only.** A read reports that a secret is held and nothing more: `{"GITHUB_CLIENT_SECRET": {"secret": true}}`. The value stays usable without being readable — a configuration document referencing `${{ GITHUB_CLIENT_SECRET }}` still resolves against the decrypted value when it is served.

Scoping a variable to one environment of a project (ADR 061 §3) is designed but not yet built; every variable is owned by the project today.
