---
---

The CLI's test suite runs three quarters of the machine's cores as Vitest workers, so CI's 4-core runners run 3 files at a time instead of 1; nothing published to npm changes.
