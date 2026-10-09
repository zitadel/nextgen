---
"@zitadel/components": patch
"@zitadel/config": patch
---

Update `liquidjs` to 10.27.2. 10.27.1 charges the `pop` filter against
`memoryLimit` (CVE-2026-55575); 10.27.2 extends that accounting to the
`join`, `json`, and `inspect` filters.
