---
"@zitadel/sdk-solid": patch
---

A widget prop that is cleared after being set now restores the web component's own default in the Solid components, instead of leaving `undefined` on the element, and an unset prop keeps that default. For example, a `heading` that goes from "Custom" back to `undefined` shows the default "Signed in as" title again rather than an empty one.
