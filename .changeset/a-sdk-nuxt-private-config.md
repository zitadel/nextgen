---
"@zitadel/sdk-nuxt": patch
---

The browser no longer reads the private `nextgen` runtime config. Every page logged NUXT_E1003,
which advised making that config public, project secret included. Keep `nextgen` private: the
browser only needs the proxy path.
