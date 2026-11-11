---
title: "Security: tighter project boundaries"
summary: Reads, sign-ins and session exchanges stay inside the project a request names or its secret belongs to, and a caller scoped to part of a project no longer learns what exists outside its scope.
date: 2026-10-26T07:18Z
cloud: true
pulls: [2205, 2228, 2046, 2297]
---

- A caller whose grants in a project are scoped to a team or a single resource now gets `404`, as for an id that names nothing, instead of `403` when reading or updating a resource outside every scope it holds, so it no longer learns whether that resource exists.
- Reading an identity provider connection, its revisions or a schema by id answers not found when the request's `project_id` names a project the resource is not in, where a project secret used to get it from its own project.
- `POST /auth_attempts` and `POST /sessions/exchange` take the project from the project secret, and answer `403` `proj.mismatch` when the request names another one. A handoff exchange is refused once the release its sign-in started on is revoked.
- `POST /flow/{id}/submit` checks an opaque `Origin` (`null`), which browsers send from sandboxed frames and `data:` pages, against the project's origins, so a project that lists its origins refuses it with `req.invalid` instead of skipping the check.
