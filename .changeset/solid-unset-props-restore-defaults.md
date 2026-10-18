---
"@zitadel/sdk-solid": patch
---

Restore the element's own default when a widget prop is cleared. A `heading`, `logoutLabel`, `variant`, `theme`, `lang`, `suppressHeader` or `suppressPasswordToggle` that went from a value back to `undefined` used to leave `undefined` on the widget instead of its default.
