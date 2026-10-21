---
"@zitadel/server": patch
---

A caller whose grants in a project are scoped to a team or a single resource no longer learns whether other resources in that project exist. Reading, changing or deleting a team, user or other resource outside every scope the caller holds now answers `404` with the resource's not-found code, exactly like an id that names nothing, instead of `403`. Inside its scope, a missing permission still answers `403`, as does any denial for a caller with a project-wide grant. Creates, project operations and lists are unchanged.
