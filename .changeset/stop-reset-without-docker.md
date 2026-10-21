---
"@zitadel/cli": patch
---

`zitadel stop` and `zitadel reset` no longer fail with `spawn docker ENOENT` on a machine without Docker. The default runtime does not need Docker, and where Docker is not installed there is no container to remove, so both now stop or reset the directory's local server as usual. `zitadel start` likewise no longer fails when it moves a directory that used `--runtime docker` back to the default runtime after Docker was uninstalled.
