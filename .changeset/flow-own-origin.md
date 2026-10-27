---
"@zitadel/server": patch
---

The console's login preview works again off `localhost`, as on the hosted cloud, for a project that lists its origins: `POST /flow` now admits the origin `server.public_base` names, though a step submitted from there is still refused unless the project lists it.
