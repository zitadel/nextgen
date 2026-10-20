---
"@zitadel/sdk-angular": patch
---

`<zitadel-auth-login>` no longer server-renders `lang="undefined"` when no `lang` is set. The language is bound as an attribute and omitted when unset, as in the other SDKs.
