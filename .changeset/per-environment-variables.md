---
"@zitadel/server": minor
"@zitadel/api": minor
---

Configuration values that differ per environment can now be stored as variables, and managed over the API.

A variable belongs to a project, and optionally to one of its environments. A configuration document references one as `${{ NAME }}`, and the value entered at the owner serving the request is substituted in. A reference that is the whole field keeps the value's type, so `"${{ RETRY_COUNT }}"` resolves to `10` rather than `"10"`; a reference inside a longer string is rendered into it, so `"https://${{ HOST }}/callback"` resolves to a URL; and a reference nothing was entered for is left as it stands. A variable marked secret is encrypted with the project's own key and stays readable after that key is rotated.

The project level and each environment are separate owners, not a hierarchy: a variable is read, written and deleted at exactly the owner addressed, and nothing is inherited in either direction. A value that has to hold in several environments is entered in each of them.

Four endpoints, all scoped to a project by the usual `project_id` and addressing one of its environments with an optional `environment_name`:

- `GET /variables` returns the variables entered at that owner, keyed by name.
- `PATCH /variables` enters or replaces variables there. Names absent from the body are untouched, so a partial body is a partial update rather than a truncation, and the body is applied whole or not at all.
- `GET /variables/{variable_name}` reads one name at that owner.
- `DELETE /variables/{variable_name}` removes what that owner entered.

Because owners do not inherit, a name one owner holds reads as `var.not_found` from another, and deleting it there leaves the original standing.

A variable is written as a bare scalar — `{"RETRY_COUNT": 10}` — or, to state secrecy, as `{"GITHUB_CLIENT_SECRET": {"value": "s3cr3t", "secret": true}}`. The shorthand always means "not a secret", so a value can never become secret by accident, and marking one always leaves a trace in the request.

**Secrets are write-only.** A read reports that a secret is held and nothing more: `{"GITHUB_CLIENT_SECRET": {"secret": true}}`. The value stays usable without being readable — a configuration document referencing `${{ GITHUB_CLIENT_SECRET }}` still resolves against the decrypted value when it is served.
