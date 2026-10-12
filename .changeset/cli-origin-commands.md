---
"@zitadel/cli": minor
"@zitadel/server": minor
"@zitadel/api": minor
---

Manage a project's origins from the CLI. `zitadel origin add <pattern> --kind primary|preview` adds one pattern and prints what the server stored, or its rejection in words; a primary pattern must be an exact URL with no wildcard, and a preview wildcard on a shared host needs a literal label of your own. `zitadel origin list` shows the patterns the project admits, and `zitadel origin rm <pattern>` stops admitting one, prompting for confirmation unless you pass `--force`. All three use the project secret and are refused with the preview-deploy token. This adds the origins endpoints and the `origins` field on the project to the API; the server handlers are not yet implemented.
