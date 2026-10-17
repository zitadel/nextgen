---
"@zitadel/api": minor
---

`configureZitadel()` dispatches a `zitadel-config-change` event on `globalThis` when it stores a new
project, so a widget that mounted before the app configured starts its flow once it does.
