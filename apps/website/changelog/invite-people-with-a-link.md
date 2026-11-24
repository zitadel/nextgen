---
title: Invite people into a project with a link
summary: zitadel invitation create prints a link that grants a project role to whoever accepts it, and the API lets a signed-in user look up, accept or decline it. Invitations now record who responded and when.
date: 2026-11-24T02:09Z
pulls: [3073, 2929]
---

`zitadel invitation create` invites someone into your project. It asks who the invitation is for and which role it grants, then prints a link to share. The link expires in 72 hours. Whoever opens it signed in sees the project, the role, the expiry and who invited them, and can accept or decline. Accepting grants the role.

```sh
zitadel invitation create --name "John Doe" --relation editor
```

- `zitadel invitation list` leaves accepted invitations out unless you ask for them with `--status`, which you can repeat. `zitadel invitation get` shows one invitation.
- `zitadel invitation cancel` names who the invitation is for and its role before it asks. It removes a pending, expired or declined invitation, and refuses an accepted one. Without an id it offers the invitations you can cancel.
- `--replaces` makes a new link for an earlier invitation.
- In the API, `POST /invitations/lookup`, `POST /invitations/accept` and `POST /invitations/reject` redeem a link. The inviter cannot accept or decline their own invitation, and an unknown or finished link always answers the same `404`.
- `GET /projects/{project_id}/invitations` takes `status` more than once, and `expand=inviter` adds who created each invitation. `DELETE` now also removes an expired or declined invitation.
- A declined invitation keeps its `metadata`, so administrators still see who a declined link was for.

**Breaking:** invitations record who accepted or declined them and when as `responded_by` and `responded_at`, which replace `accepted_by` and `accepted_at`. `status` says whether the invitation was accepted or declined. Read the new fields in code that reads invitations from the API.

[Invitations API](https://preview.zitadel.com/docs/reference/api/invitations), [zitadel invitation create](https://preview.zitadel.com/docs/reference/cli/invitation/create)
