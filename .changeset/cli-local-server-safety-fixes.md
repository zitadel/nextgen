---
"@zitadel/cli": patch
---

`zitadel stop --all` no longer stops a process just because its command names `zitadel-server.js`, such as `tail -f` or an editor open on that file: only a JavaScript runtime running the script counts. It also reads each process's whole command, so a server installed under a long path is no longer missed when `COLUMNS` is set. `zitadel setup` now refuses a local server another CLI release started when you pick it from the server question, as it already did for `--server local`, and a custom URL typed there is checked and shortened to its origin the way `--server` is. Two `zitadel start` runs in one directory can no longer report the local admin credential as malformed while the other is still writing it, and the start lock can no longer be removed from under a running start when a previous start died while clearing a stale lock.
