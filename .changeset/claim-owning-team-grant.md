---
"@zitadel/server": patch
---

Derive claim state from the active owning-team grant instead of a denormalized resource-scope team marker (ADR 054): claim/complete writes only the authz_assignments grant, claim status and events visibility read it, and a per-dialect uniqueness guarantee (partial unique index on Postgres/SQLite, NULL_FILTERED owning_team_key index on Spanner) keeps at most one active owning team per project, closing the double-claim race.
