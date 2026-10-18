---
"@zitadel/components": patch
---

`<zitadel-login>`, `<zitadel-session>` and `<zitadel-logout>` now keep their own default when a property is set to `undefined` or `null`, or when its attribute is removed. Before, `heading`, `logoutLabel`, `variant`, `theme`, `lang`, `suppressHeader` and `suppressPasswordToggle` took the blank value, so a framework wrapper that passed an unset prop rendered an empty title or lost the widget's default variant. Supplied values, including an empty string, are unchanged.
