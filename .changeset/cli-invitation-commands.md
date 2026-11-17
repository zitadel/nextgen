---
"@zitadel/cli": minor
---

`zitadel invitation create`, `list`, `get` and `cancel` invite people into a project with a shareable link, under "Users and access" in `zitadel --help`. `create` asks who the invitation is for and which role it grants, then prints the link, which expires in 72 hours; `--replaces` makes a new link for an earlier invitation. `list` leaves accepted invitations out unless `--status` asks for them, and `--status` can be repeated. `cancel` names who the invitation is for and its role before it asks, removes a declined invitation as well as a pending one, refuses an accepted or expired one with `E_VALIDATION`, and without an id offers the pending and declined invitations to pick from.
