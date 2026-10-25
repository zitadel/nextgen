---
"@zitadel/cli": minor
---

`zitadel start` no longer reports a login URL, because the server no longer serves a login page: sign in through the login page `zitadel setup` adds to your app.

**Breaking:** `zitadel start --json` no longer has `data.urls.login`; a script that reads it gets nothing there.
