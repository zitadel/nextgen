---
"@zitadel/server": minor
---

The server now answers the API under `/api/v1` (`POST /api/v1/projects`, `GET /api/v1/users/me`), so a proxy, firewall or rate limit in front of it can select API traffic by one prefix. The console, the IdP callbacks and the health probes `/livez` and `/readyz` stay at the root. Until 1.0.0 the server also answers every operation at its path without the prefix, and those responses carry a `Deprecation` header and a `Link` to the docs on the base URL: move clients that still call them to `/api/v1`, since 1.0.0 drops them.
