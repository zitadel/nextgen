---
"@zitadel/server": minor
---

A deployment freezes its kind's variables when it is created. `GET /deployments/{deployment_id}/variables` returns that set: a later change to the project does not change it, a secret reads back as `{"secret": true}`, and an empty set is `{}`. A release that references a name with no value for that kind is refused with `400` `dep.variables_missing`, and nothing is written. Deploying the same release again is a new deployment once those values have changed, and a rollback keeps the restored deployment's set.
