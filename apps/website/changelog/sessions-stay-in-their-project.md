---
title: A project secret can no longer create a session in another project
summary: POST /sessions now creates a session only in the calling secret's project, and deactivating a user ends the access their direct grants give them on their next request.
date: 2026-11-11T04:37Z
cloud: true
pulls: [2959, 2962]
---

Two security fixes.

- `POST /sessions` now creates a session only in the project of the secret that calls it. Before, any project secret could create an anonymous session in another project, receive a session token for it, and write `session.established` and `auth.token.issued` events into that project's audit log. A `project_id` naming another project is now refused with `403` `proj.mismatch`, and nothing is written.
- Deactivating a user now ends the access their direct grants give them on their next request, including through sessions they already hold, and `GET /projects/{project_id}/admins` stops listing them. Before, only the access they had through teams ended.
