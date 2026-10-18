---
"@zitadel/sdk-qwik": patch
---

Clearing a widget prop on `ZitadelLogin`, `ZitadelLogout` or `ZitadelSession` now puts the element's own default back, instead of leaving the previously set value (for example a custom `heading`) in place.
