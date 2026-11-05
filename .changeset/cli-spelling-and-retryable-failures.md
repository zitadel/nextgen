---
"@zitadel/cli": patch
---

A JSON body is now spelled with the escapes JSON itself uses, so `zitadel api` and a `--dry-run` preview stay parseable, and a refusal worth retrying is reported as one: `429` fails with `E_NETWORK` and `410` with `E_NOT_FOUND` rather than `E_VALIDATION`.
