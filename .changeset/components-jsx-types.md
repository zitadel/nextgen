---
"@zitadel/components": minor
---

New types-only `@zitadel/components/jsx` entry with React JSX declarations for `<zitadel-login>`, `<zitadel-session>`, and `<zitadel-logout>`, covering each element's full attribute/property surface plus React's standard `ref`/`key` (a `ref` resolves to the concrete element type). Reference it once (`/// <reference types="@zitadel/components/jsx" />`) to type the custom elements in TSX.
