---
"@zitadel/sdk-solid-start": patch
---

The README no longer says `@zitadel/sdk-solid` must stay out of server rendering: it ships a `solid`
export condition, so importing it in a SolidStart route is safe.
