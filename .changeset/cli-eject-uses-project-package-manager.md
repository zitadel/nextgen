---
"@zitadel/cli": patch
---

`zitadel eject` now suggests removing the SDK with the project's own package manager, such as `pnpm remove @zitadel/sdk-next`, instead of always suggesting `npm uninstall`.
