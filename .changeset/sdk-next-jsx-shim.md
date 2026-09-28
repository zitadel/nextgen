---
"@zitadel/sdk-next": minor
---

New types-only `@zitadel/sdk-next/jsx` entry that forwards the `@zitadel/components/jsx` React JSX declarations, so Next.js apps that only depend on the SDK can type the `<zitadel-*>` elements in TSX. `@zitadel/sdk-next/client` additionally re-exports the `businessLocales` overlay.
