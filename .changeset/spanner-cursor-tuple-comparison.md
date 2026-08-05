---
"@zitadel/server": patch
---

Fix cursor pagination on Spanner for lists ordered by more than one column. GoogleSQL defines no ordering over structs, so the row-value comparison the cursor compiles to was rejected and the second page failed. It is now expanded into its lexicographic form.