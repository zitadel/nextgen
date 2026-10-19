---
"@zitadel/server": patch
---

Signed-in sessions now last 24 hours by default. Until now a session expired
10 minutes after sign-in, so users were signed out every 10 minutes, even while
they were using the app. The 24 hours run from sign-in; using the session does
not extend them. Anonymous sessions created before sign-in still last 10
minutes. To choose another lifetime, set `session.default_ttl`
(`NEXTGEN_SESSION_DEFAULT_TTL`), up to `session.max_ttl` (30 days unless set);
`10m` keeps the old behavior.
