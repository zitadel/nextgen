---
"@zitadel/components": patch
---

`<zitadel-login>` no longer carries a typed password or one-time code to the next step: after "Use another account", or on any later step that asks for one, the field starts empty. A value the same step refuses is kept so it can be corrected.
