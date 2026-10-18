---
"@zitadel/sdk-angular": patch
---

An unset widget input now leaves the web component's own default in place in the Angular components, and an input that is cleared after being set restores that default, instead of leaving `undefined` on the element. For example, `<zitadel-auth-session />` without a `heading` shows the default "Signed in as" title rather than an empty one.
