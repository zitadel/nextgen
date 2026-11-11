---
"@zitadel/cli": minor
---

`setup` and `auth-method sso enable` now describe a provider's connection in a bordered box, and `sso enable --dry-run` shows it too. It reads as sentences: one line per user attribute saying which claim fills it and what verifies it; the scopes the connection requests; the attributes the signing-in schemas define that no claim fills yet, each marked required or optional; and which user schemas sign in through the connection, so a mapping change says who it affects. `sso enable` no longer prints a separate list of claim mappings. `--json` reports the connection's `claim_mapping`, `verified_claims`, `scopes`, `unmapped` and `used_by` in `data.sso[]` from `setup` and in `data.connection` from `sso enable`.
