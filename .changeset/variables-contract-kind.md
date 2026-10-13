---
"@zitadel/server": minor
"@zitadel/cli": patch
---

The variables operations take a `kind` query parameter, `primary` or `preview`, in place of `environment_name`. Reads answer each name with its value per kind, `{"NAME": {"primary": …, "preview": …}}`, and `kind` narrows them to one kind. A write naming no kind stores a plain value for both kinds and a secret for `primary` only; a removal naming no kind removes both. `GET /deployments/{deployment_id}/variables` returns the values a deployment froze. Until the server stores a kind, `kind=preview` and the deployment read answer `501`. `zitadel variables list` and `get` show the primary values.
