---
"@zitadel/components": patch
---

`<zitadel-login>` no longer schedules a second update from inside an update when config changes restart the flow, so Lit stops logging a change-in-update warning on hydrated pages.
