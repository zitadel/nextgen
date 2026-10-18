---
"@zitadel/sdk-vue": patch
---

The Vue components now bind the string props that have a widget default (`heading`, `logoutLabel`, `variant`, `theme` and `lang`) as attributes in the browser (and as plain attributes on the server, where Vue before 3.5.27 would otherwise write the `^` prefix into the markup), so an unset prop leaves the web component's own default in place instead of the empty string Vue assigns to a property. For example, `<ZitadelSession />` without a `heading` shows the default "Signed in as" title rather than an empty one, and a prop that is cleared after being set restores that default.

The Vue peer dependency is now `>=3.2`: the attribute binding needs Vue 3.2, and the components already relied on `expose`, which also arrived in 3.2.
