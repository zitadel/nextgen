---
"@zitadel/server": minor
---

`POST /invitations` creates a project invitation and returns its one-time link, or replaces an existing one with `replaces_invitation_id`. `GET /invitations` and `GET /invitations/{id}` read a project's invitations, and `DELETE /invitations/{id}` cancels a pending one. A project holds at most 100 pending invitations. Redeeming a link (`/invitations/lookup`, `/accept`, `/reject`) still returns not implemented.
