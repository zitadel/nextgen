---
"@zitadel/cli": patch
---

`zitadel claim` now refuses a server that cannot complete a claim instead of opening a claim page that never finishes and polling until the link expires. Zitadel Cloud is unaffected; a local or self-hosted server is claimable only when it hosts the platform project (`NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=true`), which `claim` now checks the same way `setup` already does before suggesting it.
