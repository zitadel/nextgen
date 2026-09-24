---
"@zitadel/cli": patch
---

The CLI README and `SKILLS.md` now describe the local admin
`admin@zitadel.localhost` that `zitadel start` creates, the one-time console
sign-in link it prints, and the `zitadel console` command that prints a fresh
one. They also say that a local `zitadel setup` attaches the project to that
admin's team, so the project is owned from the start and `zitadel claim`
reports it as already owned.
