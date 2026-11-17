---
"@zitadel/cli": minor
---

`zitadel invitation create`, `list`, `get` and `cancel` invite people into a project with a shareable link, under a new "Project administration" group in `zitadel --help`. `create` asks who the invitation is for and which role it grants, then prints the link, which expires in 72 hours; `--replaces` makes a new link for an earlier invitation. `cancel` without an id offers the pending invitations to pick from.
