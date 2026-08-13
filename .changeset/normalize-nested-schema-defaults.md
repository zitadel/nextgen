---
"@zitadel/config": patch
---

Schema normalization descends into nested `properties` when comparing local
config against the platform. Spelling out a property default (`x-editable: true`,
`x-sensitive: false`, `x-mfa: false`), applying, then removing it is a no-op —
but on a nested property the comparison could not tell, so `plan` reported a
change on every run and `apply` republished a revision each time.
