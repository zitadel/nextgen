---
"@zitadel/sdk-tanstack-start": patch
"@zitadel/sdk-react": patch
---

The TanStack Start react entry now registers the widgets and re-exports `businessLocales` from `@zitadel/components` itself, like every other client entry, and `@zitadel/sdk-react` no longer needs a type cast to hide element keys from `createComponent`.
