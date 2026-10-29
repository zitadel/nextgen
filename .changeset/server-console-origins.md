---
"@zitadel/server": minor
---

`server.console_origins` (`NEXTGEN_SERVER_CONSOLE_ORIGINS`) lists the origins the console is reached at beside the origin of `server.public_base`, such as a second hostname in front of the deployment. A flow opened from one, for a project that does not list it, is served the project's `default` target. The server no longer reads Vercel's `VERCEL_URL`, `VERCEL_BRANCH_URL` and `VERCEL_PROJECT_PRODUCTION_URL`; the hosted cloud's launcher fills the setting from them.
