---
"@zitadel/server": minor
---

A signed-in platform user redeems an invitation link: `POST /invitations/lookup` shows the project, role, inviter and expiry, `POST /invitations/accept` grants the invitation's role and `POST /invitations/reject` declines it. Accepting is refused with `inv.inviter_not_admin` when the user who created the invitation no longer administers the project. Every unknown or finished token answers the same `404`. Accepting sends `invitation.accepted`, with `authz.granted` when the role is new, and declining sends `invitation.rejected`.
