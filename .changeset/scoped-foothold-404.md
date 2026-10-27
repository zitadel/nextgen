---
"@zitadel/server": patch
---

A caller whose grants in a project are scoped to a team or a single resource now gets `404`, as for an id that names nothing, instead of `403` when reading or updating a resource outside every scope it holds, so it no longer learns whether that resource exists.
