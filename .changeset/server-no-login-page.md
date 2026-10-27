---
"@zitadel/server": minor
---

The server no longer serves a login page at `/ui/login/`, which could not sign anyone in; your app presents the login with `<zitadel-login>`, which `zitadel setup` adds. The server serves `/console/runtime.json` even with its own console off, so a console hosted elsewhere keeps working.

**Breaking:** the `server.login_enabled` and `server.login_path` settings, and the `NEXTGEN_SERVER_LOGIN_ENABLED` and `NEXTGEN_SERVER_LOGIN_PATH` variables, are gone. The server ignores them, so remove them from your configuration at your convenience. Links to `/ui/login/` now answer 404.
