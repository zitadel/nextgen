---
"@zitadel/cli": minor
"@zitadel/sdk-next": minor
---

The CLI now enforces its supported framework floors — Next.js 15 and newer, React 18 and newer. `setup` refuses a below-floor app before making any change, and `doctor` reports one the same way: both emit an explicit `E_UNSUPPORTED_PROJECT_SHAPE` error naming the floor together with an upgrade hint. Only version ranges that provably cannot resolve to a supported release are rejected — protocol specs (`file:`, `workspace:`), dist-tags (`latest`), and ranges that admit a supported version all pass. `@zitadel/sdk-next` now declares the matching peer range `next >=15`.
