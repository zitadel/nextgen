---
"@zitadel/cli": patch
---

`--server` is now declared by the commands that take a server, through one shared definition, rather than by every command. Every command that accepted it still does, with the same help text and the same server resolution, and a failure that comes before the flags are parsed still names the server it was given.
