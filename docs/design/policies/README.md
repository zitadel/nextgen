# Operation policies

Design notes for [ADR 066](../../adrs/066-operation-policies.md), which
decides the model: a policy attaches to one domain operation and splits into a
Zitadel-defined template (config schema, context schema, named boolean
CEL rules) and a developer-authored instance (config values, revisioned in
the release). The ADR holds the decisions and their rationale; these documents
hold the detail an implementer or reviewer of the code needs.

Status: the first consumer is `auth.factor.password.set`
([#898](https://github.com/zitadel/nextgen/issues/898)); the scope table below
says what the policy stack ships and what follows.

## Areas

| # | Area | Doc |
|---|---|---|
| 1 | Template: settings, config rules, the naming rule, instance validation, publishing the catalog | [`1-template.md`](1-template.md) |
| 2 | Evaluation: the context schema, the Go context builder, the limits every rule runs under | [`2-evaluation.md`](2-evaluation.md) |
| 3 | Constraints: the pre-auth projection, how it reaches a login form today, the read endpoint | [`3-constraints.md`](3-constraints.md) |
| 4 | Authoring: `.zitadel/policies/`, the CLI commands, testing a policy | [`4-authoring.md`](4-authoring.md) |
|   | Catalog: every guarded operation, its template, and the function that evaluates it | [`catalog.md`](catalog.md) |

## Scope

| Capability | In the policy stack | Later |
|---|---|---|
| Template and engine | the embedded template per operation; startup checks (type, length, cost, one setting per rule named after it); config rules; evaluation of the active rules; the `constraints` projection | the read-only catalog endpoint (`GET /policies/catalog`) |
| Instance resource | `POST /policies` (publish) and the ADR 063 reads: `GET /policies`, `GET /policies/{policy_id}`, its revisions and `GET /policies/revisions/{revision_id}`; the wire schema as a union discriminated on `operation`; every `pol.invalid` violation in `details.details.violations`; ADR 063 storage (fixed `id`, `revision_id` per publish); `policy.created` / `policy.updated` events; instances in the release bundle (`policies`, pinned under the `policy` kind); a request whose release pins a flow gets the policy that release pins, and none when it pins none | requests that resolve no release still get the newest stored revision, as for every kind, until [#1616](https://github.com/zitadel/nextgen/issues/1616) and [#2331](https://github.com/zitadel/nextgen/issues/2331) |
| Applicability | one instance per operation per project; no instance, no policy | scoping to teams or apps with an audience model ([#1264](https://github.com/zitadel/nextgen/pull/1264) proposed one); the not-weaker-than-the-project check that comes with it |
| `auth.factor.password.set` | `min_length` (1 to 64), `max_length` (1 to 64, below the domain's fixed cap of 64), `history_depth` (1 to 4, current password included, self-service only); all optional; NFC normalization; code-point length | a blocklist, if projects ask for one |
| Login surface | `min_length` and `max_length` on the `x-auth-methods#password` flow field come from the policy, `max_length` capped by the domain | `GET /policies/{operation}/constraints` for clients the flow engine does not drive |
| CLI | `zitadel setup` writes `.zitadel/policies/auth.factor.password.set.json` with no rules, and a minimum length only when the developer gives one; `deploy` carries `.zitadel/policies/` in the release bundle; `policies list` and `policies get` | `zitadel policies test` and the server-side dry run it calls |
| Enforcement | every active rule blocks | enforcement modes (`audit`), developer-authored rules |
