---
"@zitadel/server": minor
---

Inject an authz EXISTS list predicate into management list queries after a successful project-level Check. The predicate enforces RSI-backed visibility / TOCTOU for principals that already passed the gate. Team-scoped HTTP list narrowing is not live yet; SQL + stmttest are the substrate for a follow-up (#834).
