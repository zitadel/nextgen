---
"@zitadel/sdk-vue": patch
---

The Vue components now bind the string props that have a widget default (`heading`, `logoutLabel`, `variant`, `theme` and `lang`) as attributes, so an unset prop leaves the web component's own default in place instead of the empty string Vue assigns to a property. For example, `<ZitadelSession />` without a `heading` shows the default "Signed in as" title rather than an empty one, and a prop that is cleared after being set restores that default.
