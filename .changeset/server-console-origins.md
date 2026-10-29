---
"@zitadel/server": minor
---

`server.console_origins` (`NEXTGEN_SERVER_CONSOLE_ORIGINS`) lists the origins the console is reached at beside the origin of `server.public_base`, such as another hostname in front of the deployment. Like that origin, they may open any project's flow, so the console previews a project's login from each of them. The hosted cloud adds the URLs Vercel serves a deployment at, so a preview's console works on its own URL as well as on its branch alias.
