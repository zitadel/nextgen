---
"@zitadel/server": minor
"@zitadel/cli": patch
---

Variables take a `kind` query parameter, `primary` or `preview`, in place of `environment_name`, and reads return each name's value per kind. A write without `kind` stores a plain value for both kinds and a secret for `primary` only. `GET /deployments/{deployment_id}/variables` returns the values a deployment froze. Until the server stores kinds, `kind=preview` and the deployment read answer `501`.
