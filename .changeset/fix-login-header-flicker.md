---
"@zitadel/components": patch
---

Stop the `<zitadel-login>` card header flickering on every render when `suppressHeader` is left unset. An unset optional boolean reaches the element as `undefined`, which made `toggleAttribute` flip the header each commit instead of setting it; both call sites now coerce it with `=== true`.
