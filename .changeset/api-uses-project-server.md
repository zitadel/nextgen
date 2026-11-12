---
"@zitadel/cli": patch
---

`zitadel api` calls the server your project's environment names (`ZITADEL_URL`, as every other project command reads it) and takes `--env` and `--env-file`. It used to call the cloud unless you passed `--server`, sending a local or self-hosted project's secret there.
