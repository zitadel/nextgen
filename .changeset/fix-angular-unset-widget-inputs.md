---
"@zitadel/sdk-angular": patch
---

An unset widget input now leaves the web component's own default in place in the Angular wrappers, and an input that is cleared after being set restores that default, instead of leaving `undefined` or `null` on the element. For example, `<zitadel-auth-session />` without a `variant` keeps the default "widget" variant rather than `null`.
