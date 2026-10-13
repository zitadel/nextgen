---
"@zitadel/server": minor
---

The database can now store deployments to origins, previews, and revoked
releases. Nothing uses this yet: the deployment, preview and revoke endpoints
still answer 501.

- **Deployments go to origins.** A deployment records one release and the
  origins it went to, such as `https://app.acme.com`. An origin serves the
  latest deployment made to it. Deployments are never changed after they are
  written, so every origin keeps its full history.
- **Two deploys at once to the same origin can't both win.** The second one is
  refused and has to try again.
- **Previews.** A deployment to a preview URL also stores when that preview
  expires. Expired previews stop serving and can be removed, without losing
  their history.
- **Revoked releases.** A release can be marked as revoked. A release that a
  deployment uses can no longer be deleted.
- **Environments are gone from deployments.**
