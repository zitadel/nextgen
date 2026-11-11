---
"@zitadel/server": patch
---

Deactivating a user now ends the access their direct grants give them on their next request, including through sessions they already hold. Before, only the access they had through teams ended.
