---
"@zitadel/server": minor
---

Variables are stored per kind. `kind=preview` reads and writes preview values, and a read naming no kind answers both. A write naming no kind stores a plain value for both kinds and a secret for `primary` only. A project holds at most 79 variables per kind; a write past that answers `400` with `var.too_many`. Setting and removing a variable emits `variable.set` and `variable.removed` events carrying the kind and the secret flag, never the value.
