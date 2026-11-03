---
title: The server no longer serves a login page
summary: The server's page at /ui/login/, which could not sign anyone in, is gone. Your app presents the login with the login component, which zitadel setup adds.
date: 2026-10-25T01:55Z
cloud: true
pulls: [2307]
---

The server no longer serves a login page at `/ui/login/`, which could not sign anyone in. Your app presents the login with `<zitadel-login>`, which `zitadel setup` adds. The server still serves `/console/runtime.json` with its own console off, so a console hosted elsewhere keeps working.

**Breaking:** links to `/ui/login/` now answer 404. The `server.login_enabled` and `server.login_path` settings, and the `NEXTGEN_SERVER_LOGIN_ENABLED` and `NEXTGEN_SERVER_LOGIN_PATH` variables, are gone; the server ignores them, so remove them from your configuration at your convenience. From the 0.2.0 CLI, `zitadel start` no longer reports a login URL, and `zitadel start --json` no longer has `data.urls.login`.

[The login component](https://preview.zitadel.com/docs/sdks/components)
