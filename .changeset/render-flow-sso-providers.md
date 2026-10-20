---
"@zitadel/server": minor
---

Render a flow step's `sso_providers` from the identity provider connections
it names. The definition keeps a list of connection slugs; every render
resolves each slug at its newest revision and emits `{id, name, template}`
from the connection's `slug`, `display_name` and `template`, in the step's
order. A connection without `template` renders `template: ""`. A slug with
no connection in the project is dropped from the rendered step and logged.
