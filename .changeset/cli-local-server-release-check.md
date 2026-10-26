---
"@zitadel/cli": minor
---

`zitadel setup`, `zitadel console`, `zitadel api`, `zitadel env add` and every command that works on a project now refuse a running local server that another CLI release started, as a process or a container, before they send it anything: that server serves its own release's API. Run `zitadel start` to restart it on this release (its data stays), then run the command again. `zitadel doctor` warns about such a server.
