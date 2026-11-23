---
"@zitadel/cli": minor
---

`zitadel invitation create`, `list`, `get` and `cancel` invite people into a project with a shareable link, under "Users and access" in `zitadel --help`. `create` asks who the invitation is for and which role it grants, then prints the link, which expires in 72 hours; `--replaces` makes a new link for an earlier invitation. `list` leaves accepted invitations out unless `--status` asks for them, and `--status` can be repeated. `cancel` names who the invitation is for and its role before it asks, removes an expired or declined invitation as well as a pending one, refuses an accepted one with `E_VALIDATION`, and without an id offers the pending, expired and declined invitations to pick from. `create` and `cancel` report an anonymous `invitation_created` or `invitation_cancelled` event once the server confirms, carrying the role and a random journey ID, never a name, an invitation ID or the link; cancelling an expired or declined invitation reports none.
