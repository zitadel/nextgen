# Operation policies

Design notes for [ADR 066](../../adrs/066-operation-policies.md), which
decides the model: a policy attaches to one domain operation and splits into a
Zitadel-defined **template** (config schema, context schema, named boolean
CEL rules) and a developer-authored **instance** (config values, revisioned in
the release). The ADR holds the decisions and their rationale; these documents
hold the detail an implementer or reviewer of the code needs.

**Status:** the first consumer is `user.password.save`
([#898](https://github.com/zitadel/nextgen/issues/898)); the scope table below
says what the policy stack ships and what follows.

## Areas

| # | Area | Doc |
|---|---|---|
| 1 | **Template**: the settings markers (`fixed`, `public`, `recommended_minimum`), instance validation, publishing the catalog | [`1-template.md`](1-template.md) |
| 2 | **Evaluation**: the context schema, the Go context builder, the limits every rule runs under | [`2-evaluation.md`](2-evaluation.md) |
| 3 | **Constraints**: the pre-auth projection, how it reaches a login form today, the read endpoint | [`3-constraints.md`](3-constraints.md) |
| 4 | **Authoring**: `.zitadel/policies/`, the CLI commands, testing a policy | [`4-authoring.md`](4-authoring.md) |
| — | **Catalog**: every guarded operation, its template, and the function that evaluates it | [`catalog.md`](catalog.md) |

## Scope

| Capability | In the policy stack | Later |
|---|---|---|
| Template and engine | the embedded template per operation; startup checks (type, length, cost); evaluation with every rule run; the `constraints` projection; warnings for a value below `recommended_minimum` | the read-only catalog endpoint (`GET /policies/catalog`) |
| Instance resource | `POST /policies`, `GET /policies/{id}`, `GET /policies`; immutable revisions; `policy.created` event; the wire schema as a union discriminated on `operation` | release-pinned resolution: today the newest stored revision of the project's instance applies |
| Applicability | one instance per operation per project | scoping to teams or apps, decided in the audience-scoped configuration draft ([#1264](https://github.com/zitadel/nextgen/pull/1264)); the not-weaker-than-the-project-default check that comes with it |
| `user.password.save` | `min_length` (8 to 64, default 15), fixed `max_length` 64, `history_depth` (0 to 4) checked against the current password; NFC normalization; code-point length | the `blocklist` rule; a history table beyond the current password |
| Login surface | `minLength` and `maxLength` on the `x-auth-methods#password` flow field come from the policy | `GET /policies/{operation}/constraints` for clients the flow engine does not drive |
| CLI | `zitadel setup` scaffolds `.zitadel/policies/user.password.save.json` and publishes revision 1; `plan` and `apply` publish new revisions; `policies list` and `policies get` | `zitadel policies test` and the server-side dry run it calls |
| Enforcement | every rule blocks | enforcement modes (`audit`), developer-authored rules |
