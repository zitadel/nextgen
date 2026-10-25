---
"@zitadel/server": patch
---

The console's login preview shows a project's login again when the console is not on `localhost`, as on the hosted cloud. For a project that lists its origins, the preview failed with "… is not an origin of this project", because it opens the flow from the server's own origin. `POST /flow` now admits the origin `server.public_base` names, as it admits a loopback origin; a step submitted from there is still refused unless the project lists that origin.
