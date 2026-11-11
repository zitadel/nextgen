---
title: Deploy a release to preview URLs
summary: Deploy a release to preview URLs that match your project's preview patterns, for up to a year, then list the live previews and end one when you are done.
date: 2026-10-26T10:49Z
cloud: true
pulls: [1855, 1849]
---

`POST /deployments` now deploys a release to the preview URLs named in `targets`, each matching one of the project's preview patterns, and keeps each live for the request's `ttl`: an ISO-8601 duration of up to 365 days, or 7 days without one.

- `GET /projects/{project_id}/previews` lists the project's live previews, newest first, with their expiry.
- `POST /projects/{project_id}/previews/remove` ends one at once. Removing a URL with no live preview answers `204` too, and a removal that ends a preview is recorded in the audit stream as `preview.removed`.

[Deploy a release in the API reference](https://preview.zitadel.com/docs/reference/api/deployments/createDeployment)
