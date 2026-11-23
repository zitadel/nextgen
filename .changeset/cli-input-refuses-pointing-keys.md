---
"@zitadel/cli": patch
---

An `--input` document can no longer set `server`, `env`, `env-file` or `cwd`, so a document read from elsewhere cannot point the run's credentials at another server or project: type those beside `--input`. A document that is not JSON is refused without quoting the text around the error, a path that is not a regular file of at most 8 MB is refused, `api` sends a trimmed path id, a second `--input` is refused, and `FORCE_COLOR=0` or `false` turns colour off.
