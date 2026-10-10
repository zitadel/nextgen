---
"@zitadel/server": patch
---

`platform.home.url` names an identity home whose sessions this deployment
accepts: a session cookie the server cannot introspect is validated by
asking the home (`GET /sessions/me`, cached for `platform.home.cache_ttl`,
a minute by default), and the home's user is provisioned into this
deployment's platform project on first sight, under the same id, with a
personal team. Needs `platform.bootstrap_project`; request headers for the
home go under `platform.home.headers`.
