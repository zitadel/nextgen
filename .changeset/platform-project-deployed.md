---
"@zitadel/server": minor
---

The platform project is now deployed like any project: console sign-in is served a release of the configuration the server ships, including the recommended password policy (at least 15 characters, as `zitadel setup` writes), and a new server version's defaults reach the console on its first start.

**Breaking:** the console signs in only at `server.public_base`, and new console passwords need at least 15 characters. Set `server.public_base` to the address you use. Configuration set on the platform project through the API no longer applies: every start deploys what the server ships.
