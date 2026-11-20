---
"@zitadel/server": minor
---

The console shows an application at `/applications/{application_id}`: each OAuth client with its client ID, type, grant types, redirect URIs and document as JSON or YAML. The page is read-only and opened by its URL; the console does not list applications yet. `GET /applications/{application_id}` now also accepts a console session with access to the project.
