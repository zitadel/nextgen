---
"@zitadel/cli": patch
---

`zitadel release revoke` on a release origins still serve now names only the first three origins and counts the rest, and with `--json` lists every serving origin, with its kind and deployment, in `details.origins` instead of echoing the server's raw answer.
