---
"@zitadel/server": minor
---

The console now has User schema screens under Users. The list shows every schema
in the project with the attributes it collects, its enabled sign-in methods, and
the id and creation date that identify it. Opening one shows its fields as a
`FIELD | TYPE | REQ.` table — nested objects drill in — beside the document
itself as JSON or YAML with a copy button, and a second tab listing each sign-in
method the schema declares as enabled or disabled. Schemas stay read-only in the
console; the viewer names the CLI command that applies a change instead.
