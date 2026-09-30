---
---

Standardize the JS test runners on Vitest with a single shared config base and a uniform moon `test:all` task, bring the components/api-mock browser lanes into CI, and cache each package's Vitest build in a per-package `.vitest` dir. Test tooling and config only — no shipped behavior changes.
