---
"@zitadel/server": minor
---

A deployment freezes its kind's variables when it is created, and `GET /deployments/{deployment_id}/variables` returns that set, a secret as `{"secret": true}` ([docs](https://preview.zitadel.com/docs/reference/api/deployments/getDeploymentVariables)). A release that references a name without a value for that kind is refused with `400` `dep.variables_missing`, and a rollback keeps the restored deployment's set.
