---
"@zitadel/server": minor
---

A deployment can target preview URLs. Deploying to URLs that match the project's preview patterns creates or renews a preview for each, with its expiry set from `ttl`, and each target carries that expiry as `expires_at`. `GET /previews` lists the live previews and `POST /previews/remove` ends one by URL, answering `204` whether or not a preview was live. The preview operations answer `501` until the server deploys to targets.
