---
"@zitadel/cli": patch
---

`zitadel doctor` now says when it checks a local server started in a parent folder, in the runtime check and when that server is unhealthy. The unhealthy message names the parent, says that `reset --force` deletes the parent's local data, and suggests a plain `start` to give the current folder a server of its own.
