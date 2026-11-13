---
"@zitadel/cli": patch
---

`zitadel release revoke` on a release origins still serve now names only the first three origins, counts the rest, and suggests removing only the first three previews. With `--json`, `details` is `{ release_id, origins }`, listing every serving origin with its kind and deployment, instead of the server's `status`, `url` and `body`.
