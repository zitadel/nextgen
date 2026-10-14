---
"@zitadel/components": patch
---

`<zitadel-login>` starts one flow when the same project reaches it twice: as attributes first,
then as a `project` handle or a `configureZitadel()` call. Qwik and Qwik City login pages created two
flows per visit, and the first step re-rendered after it was shown.
