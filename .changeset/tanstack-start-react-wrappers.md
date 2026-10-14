---
"@zitadel/sdk-tanstack-start": patch
---

`@zitadel/sdk-tanstack-start/react` now re-exports `@zitadel/sdk-react`'s widgets instead of keeping its own copy, which had drifted: its `ZitadelLogin` silently dropped `onFlowRedirect` and `children`, and it had no `ZitadelSession`. The `/client` entry now exports the `ZitadelSession` element too.
