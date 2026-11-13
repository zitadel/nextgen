---
"@zitadel/server": minor
---

Invitations record who accepted or declined them and when as `responded_by` and `responded_at`, replacing `accepted_by` and `accepted_at`; `status` says which. Declining keeps the invitation's `metadata`, so administrators still see who a declined link was for, and `DELETE /projects/{project_id}/invitations/{id}` now also removes a declined invitation. `GET /projects/{project_id}/invitations` takes `status` more than once to match any of several statuses (for example `status=pending&status=expired&status=rejected`), and `expand=inviter` adds the creator to each invitation as `inviter`.
