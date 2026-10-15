---
"@zitadel/server": minor
"@zitadel/api": minor
---

`GET /deployments/{deployment_id}` reads one deployment, and `GET /deployments` lists them newest first. `origin` narrows the list to one origin's history, `live=true` lists what each origin serves now instead, and `expand=release` embeds the release each deployment made live.
