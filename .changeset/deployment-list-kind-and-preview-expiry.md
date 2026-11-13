---
"@zitadel/server": minor
"@zitadel/cli": minor
---

A deployment to preview URLs now records the expiry it set, and `GET /deployments`, `GET /deployments/{deployment_id}` and the create response return it as `targets[].expires_at`. A later deployment to the same URL renews the preview but leaves an earlier deployment's expiry as it was. The newest preview deployment of each URL is filled in from its live preview when the server upgrades; older ones report no `expires_at`, and `kind` still says they are previews.

`zitadel deployment list` and `zitadel deployment get` now show each deployment's kind, primary or preview, and when a preview deployment expires; `deployment list` adds them as two columns after `deployed_at`, so a script that reads the headerless `--plain` rows by position keeps working.

A preview deployment is no longer taken for a primary one because it carries no expiry: rollback, the deploy diff and the lockout guard now go by its kind.
