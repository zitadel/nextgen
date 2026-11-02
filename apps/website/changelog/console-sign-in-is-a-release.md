---
title: A self-hosted console signs in with the configuration its server ships
summary: "The platform project is deployed like any project: console sign-in is served a release of what the server ships, with the recommended 15-character password minimum. Set server.public_base to the address you use."
date: 2026-10-30T14:51Z
cloud: true
pulls: [2469, 2462]
---

The platform project, which the console signs in to, is now deployed like any project. Console sign-in is served a release of the configuration the server ships, including the recommended password policy of at least 15 characters, as `zitadel setup` writes, and a new server version's defaults reach the console on its first start.

`server.console_origins` (`NEXTGEN_SERVER_CONSOLE_ORIGINS`) names more origins the console is reached at, beside `server.public_base`'s, and the console previews a project's login from each of them. On the hosted cloud, a preview's console now works on its deployment URL as well as on its branch alias.

**Breaking:** the console signs in only at `server.public_base` or a loopback address, and new console passwords need at least 15 characters. Set `server.public_base` to the address you use, and list any other in `server.console_origins`. Configuration set on the platform project through the API no longer applies: every start deploys what the server ships.

[The configuration guide](https://github.com/zitadel/nextgen/blob/main/docs/quick-start/configuration.md)
