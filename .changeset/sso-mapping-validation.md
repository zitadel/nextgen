---
"@zitadel/cli": minor
---

`setup`, `auth-method sso enable` and `deploy --dry-run` now describe a provider's connection the same way, in a bordered box. It reads as sentences: one line per user attribute saying which claim fills it and, in the same line, what makes it verified; the scopes the connection requests; the attributes the signing-in schemas define that no claim fills yet, each marked required or optional; and which user schemas sign in through the connection, so a mapping change says who it affects. `setup` and `sso enable` also say where the connection stands (saved in the project, or applied to the server, and untested until a real sign-in) and what is still to do, and `sso enable` no longer prints a separate list of claim mappings or next steps after it. `--json` reports the connection's `claim_mapping`, `verified_claims`, `scopes` and `state` in `data.sso[]` from `setup` and in `data.connection` from `sso enable`.
