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
zero designation logic of their own; the console's users list gains a
leading identity column on exactly that chain and its convention-based
display-name guesser is removed.
