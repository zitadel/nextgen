---
"@zitadel/server": minor
---

Declining an invitation keeps its `metadata` and records `rejected_at`, so administrators still see who a declined link was for, and `DELETE /projects/{project_id}/invitations/{id}` now also removes a declined invitation. `GET /projects/{project_id}/invitations` takes `status` more than once to match any of several statuses (for example `status=pending&status=expired&status=rejected`), and `expand=inviter` adds the creator to each invitation as `inviter`.
