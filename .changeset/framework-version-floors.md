---
"@zitadel/cli": minor
"@zitadel/sdk-next": minor
---

The CLI now enforces the supported framework floors — Next.js 15+ and React 18+ (ADR 043): `setup` refuses a below-floor app before any mutation and `doctor`'s framework check fails on one, both with an explicit `E_UNSUPPORTED_PROJECT_SHAPE` error naming the floor and an upgrade hint; unparseable version specs still pass. `@zitadel/sdk-next`'s peer range follows the floor (`next >=15`).
