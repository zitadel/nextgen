---
title: Sign-ins use exactly what their release pins
summary: A sign-in now uses the schema, branding and sign-in connections its release pins, and the variables its deployment froze, so a deploy or a new revision does not change a sign-in under way.
date: 2026-10-27T15:51Z
cloud: true
pulls: [2232, 2045, 2276]
---

A sign-in that resolves to a release now uses the user schema, branding and identity provider revisions that release pins, the built-in login branding when it pins a flow but no branding, and the SSO client credentials frozen with its deployment. A sign-in with no release still uses the newest revisions and the project's current variables.

- A deploy during a sign-in does not change that sign-in's steps. Once the release it started on is revoked, `GET /flow/{id}` and `POST /flow/{id}/submit` answer `409` `rel.revoked`.
- A deployment freezes its kind's variables when it is created, and `GET /deployments/{deployment_id}/variables` returns that set, a secret as `{"secret": true}`. A release that references a name without a value for that kind is refused with `400` `dep.variables_missing`, and a rollback keeps the restored deployment's set.

[Deployment variables in the API reference](https://preview.zitadel.com/docs/reference/api/deployments/getDeploymentVariables)
