---
"@zitadel/server": minor
---

The server no longer serves a login page at `/ui/login/`. That page could not sign anyone in: it ended a sign-in without creating a session, and nothing sent users to it. Your application presents the login with `<zitadel-login>`, which `zitadel setup` adds to it. The server now serves `/console/runtime.json`, the document the console finds its sign-in project in, even with its own console off, so a console hosted elsewhere keeps working.

**Breaking:** the `server.login_enabled` and `server.login_path` settings, and the `NEXTGEN_SERVER_LOGIN_ENABLED` and `NEXTGEN_SERVER_LOGIN_PATH` variables, are gone. The server ignores them, so remove them from your configuration at your convenience. Links to `/ui/login/` now answer 404.
