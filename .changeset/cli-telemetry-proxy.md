---
"@zitadel/cli": minor
---

The CLI now sends its usage analytics through the Zitadel cloud (`preview.zitadel.com`), which passes them on to Mixpanel, instead of straight to `api-eu.mixpanel.com`. What it sends is unchanged; a network that allows only Mixpanel's address now has to allow `preview.zitadel.com`.
