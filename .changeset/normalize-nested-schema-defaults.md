---
"@zitadel/config": patch
---

Schema normalization descends into nested `properties` when comparing local
config against the platform. Spelling out a property default (`x-editable: true`,
`x-sensitive: false`, `x-mfa: false`), applying, then removing it is a no-op —
but on a nested property the comparison could not tell, so `plan` reported a
change on every run and `apply` republished a revision each time.

State hashes are computed over the normalized form, so a schema that spells out
a default on a nested property hashes differently than it did before. The first
`plan` after upgrading reports a revision for that schema with an empty field
diff, and `apply` publishes it and re-pins the flows that reference it. It
happens once — the new hash is stored and every later run is a skip. Schemas
without a spelled-out nested default are unaffected.
