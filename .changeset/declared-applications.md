---
"@zitadel/server": minor
---

A release can declare applications: `POST /releases/build` takes `applications`, served by the deployments of that release ([docs](https://preview.zitadel.com/docs/reference/api/releases/buildRelease)), and a deploy is refused while a declared client's `${{ NAME }}` secret variable has no value or holds a plain value. `GET /applications/revisions/{revision_id}` reads what a release pins, and the console's release detail lists the applications and OAuth settings it pins.
