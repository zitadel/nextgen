---
"@zitadel/cli": patch
---

`setup` and `doctor` now refuse a Vue app below 3.2, matching the Vue SDK's peer range, so a project on Vue 3.0 or 3.1 gets the upgrade hint instead of an SDK that fails at runtime.
