---
title: The console's login preview works on preview.zitadel.com again
summary: The login preview in the console works again off localhost, as on the hosted cloud, for a project that lists its origins.
date: 2026-10-24T04:02Z
cloud: true
pulls: [2294]
---

The console's login preview works again off `localhost`, as on preview.zitadel.com, for a project that lists its origins: `POST /flow` now admits the origin the server's `server.public_base` names, though a step submitted from there is still refused unless the project lists it.
