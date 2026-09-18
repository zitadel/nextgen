---
"@zitadel/testing": minor
---

`seedSession` now authenticates through the auth-attempt API instead of driving the project's login flow, so a seeded session no longer depends on how that project configures login — a custom flow, an extra branch or a reordered step cannot break seeding. Its `flowDefinitionName` option is gone for the same reason: there is no flow to select. A project that requires more than a password now fails at handoff rather than returning a session that skipped a factor.
