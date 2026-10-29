---
"@zitadel/server": minor
---

The platform project is now deployed like any project: console sign-in is served a release of the configuration the server ships, and a new server version's defaults reach the console on its first start.

**Breaking:** the console signs in only at `server.public_base` (or a loopback address). Set `server.public_base` to the address you use.
