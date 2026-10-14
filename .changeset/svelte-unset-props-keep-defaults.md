---
"@zitadel/sdk-svelte": patch
---

Leave unset widget props to the element's defaults. `<ZitadelSession>` without a `heading` no longer
renders an empty title, and an unset `variant`, `theme`, `lang` or `suppressHeader` keeps the
element's own default.
