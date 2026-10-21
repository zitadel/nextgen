---
"@zitadel/cli": minor
---

`zitadel setup --dev-port <port>` now moves an app that's already set up to another port instead of skipping it. It allows the new origin on the server, then updates the dev script or dev-server config, `ZITADEL_ISSUER` in `.env.local` and `zitadel.json` together, so an app whose port is taken (`EADDRINUSE`) signs in on the new port after one command. The README and AGENTS.md sections setup writes name this command.
