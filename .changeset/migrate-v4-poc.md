---
"@zitadel/server": minor
---

`nextgen migrate-v4` adds an offline migration proof of concept for organizations, human users, passwords and OIDC identity links. Assessment blocks unsupported authentication policies before import. Interrupted imports resume, password rehashes survive reruns, and verification compares source and target data. Both servers must be stopped during import; continuous sync and production cutover verification are not yet supported.
