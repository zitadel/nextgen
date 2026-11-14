---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": patch
---

A deployment's targets no longer declare `expires_at`. The server never returned it; a preview's expiry is on `GET /projects/{project_id}/previews`.

`zitadel deployment rollback` and the diff and lockout checks of `zitadel deploy` now read a deployment's `kind`, so a preview deployment is no longer taken for a primary one. `zitadel preview` reports each URL's expiry from its live preview.

**Breaking:** in the Go client, `api.DeploymentTarget` has no `ExpiresAt` field. In `@zitadel/api`, a deployment target has only `origin`.
