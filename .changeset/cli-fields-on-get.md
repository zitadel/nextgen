---
"@zitadel/cli": minor
---

`variable get`, `invitation get` and `deployment get` now take `--fields` like every other `get` and every list: comma-separated dot-paths cut both the `--json` data and the rows a person reads to the fields named, and a path the record cannot carry is refused up front with `E_VALIDATION` and the available paths. Without `--fields` nothing changes.
