---
"@zitadel/api": minor
"@zitadel/server": minor
---

A release can declare applications: `POST /releases/build` takes `applications`, each pinned to the release and served by the deployments of that release ([docs](https://preview.zitadel.com/docs/reference/api/releases/buildRelease)). A declared client names its secret as a `${{ NAME }}` secret variable, and `GET /applications/revisions/{revision_id}` reads what a release pins.
