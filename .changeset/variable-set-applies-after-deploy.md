---
"@zitadel/cli": patch
---

`variable set` now says the new value applies after the next `deploy` and suggests that command, because a sign-in keeps using the variables the last deploy froze. The API reference's sample for the variable operations names the real `variable set` and `variable rm` commands.
