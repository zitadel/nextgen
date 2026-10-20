---
---

Internal `apps/cli` refactor: `describeBody` and `needsRawBody` read the schema shape through one `objectShape` helper instead of each asserting the type inline. No shipped behavior changes.
