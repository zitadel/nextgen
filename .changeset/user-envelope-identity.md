---
"@zitadel/server": minor
"@zitadel/api": minor
---

User responses carry the derived identity of ADR 058 §3a: the envelope
gains read-only `identifier`, `identifier_property`, and `display`,
resolved live from each user's own schema designations
(`x-identifier`/`x-display`) on every read path — query users (one batch
resolution per page), get by id, `users/me`, and the create read-back.
Clients render `display`, falling back to `identifier`, then `id`, with
zero designation logic of their own. The embedded console (shipped inside
`@zitadel/server`) renders them: the users list gains a leading **User**
identity column on exactly that chain plus a dedicated role-named
**Identifier** column (platform-derived, outside the schema-driven column
set), the user detail heads with the identity, and the console's
convention-based display-name guesser is removed.
