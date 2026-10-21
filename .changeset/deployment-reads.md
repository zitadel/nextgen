---
"@zitadel/server": minor
"@zitadel/api": minor
---

`GET /deployments/{deployment_id}` reads one deployment and `GET /deployments` lists them newest first, each with its `kind` and `status`. `origin` narrows the list to one origin, `live=true` lists what is served now, and `expand=release` embeds the release each deployment made live.
