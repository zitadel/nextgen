---
"@zitadel/server": minor
---

Validate flow definitions and branding revisions against the same rules the editor schema already enforced: unknown fields are rejected, step names must be lowercase identifiers, audience ids and step fields must be unique, action names must be non-empty, and asset URLs must be https (or loopback http for local development). Runtime steps now describe their actions with a separate schema, so the engine-injected `back` action is no longer accepted in a flow definition.
