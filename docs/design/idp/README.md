# Identity Providers

This document contains planning notes for [zitadel/nextgen#851](https://github.com/zitadel/nextgen/issues/851) —
"Enable social login with Google and GitHub": letting developers enable social sign-in from the
CLI and guiding them through the provider setup it requires.

**Status:** design discussion, nothing implemented. There is no IdP server contract
yet ([ADR 007](../../adrs/007-gitops-configuration-surface.md)), so every decision
here is provisional until the API lands.

**Scope split.** Authentication methods belong to a user schema; provider
connections are separate Project-level resources. The CLI presents Google and
GitHub alongside passkey and password because the developer's question is "how
should these users sign in?" — but a connection existing does not make it
available to every schema, and one connection can serve many.

## Areas

The epic decomposes into six areas, roughly in dependency order, one doc
per area.

| # | Area | Doc |
|---|---|---|
| 1 | **IdP resource model** — declarative connection, syncer, schema, secrets, catalog | [`1-resource-model.md`](1-resource-model.md) |
| 2 | **Auth-method selection** — `x-auth-methods.sso`, provider slugs, flow cross-validation | [`2-auth-method-selection.md`](2-auth-method-selection.md) |
| 3 | **Social login flow** — the SSO ceremony, identity resolution, conflicts, recovery | [`3-social-login-flow.md`](3-social-login-flow.md) |
| 4 | **Provider setup sub-journey** — callback URI surfacing, credential capture, preview | [`4-cli-provider-setup.md`](4-cli-provider-setup.md) |
| 5 | **Post-claim CLI menu** — Project menu, Configure submenu, "Sign-in methods" | [`5-post-claim-menu.md`](5-post-claim-menu.md) |
| 6 | **Test-sign-in journey** — distinguishing provider misconfiguration from journey failure | [`6-test-sign-in.md`](6-test-sign-in.md) |

## Scope for #851

The six areas describe the target model. The following table describes the functionalities shipped as part of [#851](https://github.com/zitadel/nextgen/issues/851) and the functionalities that are deferred. Cells marked *epic* cite the epic's related future work; nothing in these docs designs them.

| Capability | In 851 | Later                                                                                                                                  | Doc |
|---|---|----------------------------------------------------------------------------------------------------------------------------------------|---|
| Connection resource | • `.zitadel/idps/*.json`<br>• the `idp-connection.json` schema<br>• the server CRUD API: create, revise, get by slug, slug uniqueness<br>• a unique connection id, minted at create and shared by all revisions; identity links key on it<br>• the syncer that keeps the server in step with the local connection files, through that API | • delete: settled as tombstoning with slug reservation, specified by the CRUD API, exercised by no 851 journey                                                                                                | [1](1-resource-model.md) |
| Protocols and vendors | • `oidc` block (Google)<br>• `oauth2` block (GitHub)<br>• the engine implements two protocols, not two vendors | • custom providers (*epic*; the catalog ships `google` and `github`)<br>• Apple's `secret_strategy`                                                                                      | [1](1-resource-model.md) |
| Strategy registry | • `supplementary_fetch: github_primary_email` only, so GitHub returns the email when it is not public | • further slots and entries as more providers are supported                                                                            | [1](1-resource-model.md) |
| Claim mapping | • `claim_mapping` on the connection: schema property name → provider claim name<br>• the CLI derives it from the provider catalog's claim table, keeping the properties the schema declares; reuse for a second schema extends it<br>• the engine prefills and fills properties from it at sign-up<br>• edits are by hand, checked at plan time (unknown target, empty intersection) | • editing the mapping through a CLI or Console journey (*epic*)                                                                             | [1](1-resource-model.md), [4](4-cli-provider-setup.md) |
| Provisioning and verification | • `creation` on the connection: `disabled` or `auto` (default)<br>• `verified_claims` evaluated per property at callback; the result is reported by the test journey, not enforced | • `creation: auto_only`<br>• `x-verify`<br>• gating creation on verification<br>• `is_auto_update`<br>• per-user-type narrowing through authentication method settings ([#898](https://github.com/zitadel/nextgen/issues/898))                                                                | [1](1-resource-model.md), [3](3-social-login-flow.md) |
| Account conflicts | • the conflict step: sign in as the existing account<br>• no email-based linking<br>• the external identity is discarded | • account-linking journey and its policy fields                                                                                        | [3](3-social-login-flow.md) |
| Secrets | • env refs in committed config<br>• values in `.env.local`<br>• the dev-runtime join into the engine process | • production secret store                                                                                                              | [1](1-resource-model.md), [4](4-cli-provider-setup.md) |
| Environments | • development only: the one environment with an exact issuer | • deployed environments, blocked by the Environments epic ([#534](https://github.com/zitadel/nextgen/issues/534)) for callback URIs and test targets, and by the secret-store open question for the client secret; until both land, a deployed release cannot complete a provider sign-in                        | [4](4-cli-provider-setup.md), [6](6-test-sign-in.md) |
| Auth-method selection | • `sso.providers` on the user schema<br>• validator rules<br>• one connection for many schemas (epic requirement)<br>• schema picker post-claim |                                                                                                                                        | [2](2-auth-method-selection.md), [5](5-post-claim-menu.md) |
| Login flow | • `sso` submission<br>• the server-side, single-use record behind the OAuth `state` parameter, and the callback route<br>• token exchange<br>• creation gate with a collection step<br>• returning users by `(connection, subject)`<br>• recovery routes |                                                                                              | [3](3-social-login-flow.md), [4](4-cli-provider-setup.md) |
| Egress policy | • baseline deny list, owned by [#928](https://github.com/zitadel/nextgen/issues/928), blocking | • operator-level configuration, under #928; the connection schema carries no egress fields                                                                                                                | [3](3-social-login-flow.md) |
| Provider setup | • a provider catalog bundled in `packages/config`, two entries (`google`, `github`), each carrying the protocol block defaults, the claim table, display name, console and docs URLs, and callback guidance<br>• callback URI per environment<br>• credential capture<br>• reuse of a matching connection | • secret rotation UX beyond no-clobber in `.env.local` | [4](4-cli-provider-setup.md) |
| Post-claim menu | • Project menu<br>• Configure submenu<br>• Sign-in methods | • User profiles and Login journeys                                                                                                     | [5](5-post-claim-menu.md) |
| Test journey | • `zitadel test sign-in` against development<br>• verdict split into provider or journey failure | • multi-environment targets<br>• credential preflight probe                                                                            | [6](6-test-sign-in.md) |
| Provider management | • connections exist only as a side effect of the Sign-in methods journey, and are edited by hand in `.zitadel/idps/` | • managing providers on their own in the CLI and Console (*epic*)<br>• imperative runtime disable (area 1, Open Points) | [1](1-resource-model.md), [5](5-post-claim-menu.md) |
| Console | • read-only views of schema methods and Project connections (ticket work, no design doc) | • management (*epic*) |  |

**Blocking open questions.** Everything else stays in each doc's Open Points.

- Egress policy for tenant-authored URLs: [#928](https://github.com/zitadel/nextgen/issues/928).
- The development secret join, so a local engine can complete a token exchange (area 4, Work Items).
- The server CRUD API, with the unique connection id and slug uniqueness (area 1, Exported Requirements). There is no IdP server contract yet.

## Product decisions

Product decisions that change what customers can model, not only how the code is built.

| Decision | Status in the docs | Options | Where |
|---|---|---|---|
| One connection shared by several user schemas | One connection can serve many schemas (epic). A user belongs to one schema, and an identity link is `(connection, subject)` with no schema on it. When the same Google account arrives through a second schema's journey, area 3 fails closed with a flow-level error (option 3, as a dead end rather than an explanation) and lists the rule as open. Reachable in 851 once two schemas enable the same connection through the post-claim picker (area 5). | • resolve to the same Project user<br>• allow a separate user under each schema: the link becomes `(connection, schema, subject)`. Needs a revision-stable schema identity (`users.schema_url` names a revision, and schema lineage exists only in the CLI's local state) and a per-schema uniqueness scope (`x-unique` offers project or team), or the second sign-up collides on shared unique properties and lands on the conflict step<br>• refuse the identity for the second schema | [3](3-social-login-flow.md#open-points), [1](1-resource-model.md#linking-safety) |
| Provisioning on the connection or in a policy | The connection carries `creation` as a ceiling: how far this provider's data is trusted. Per-user-type behaviour (Customers may sign up with Google, Employees only sign in) belongs to authentication method settings ([#898](https://github.com/zitadel/nextgen/issues/898)), which may narrow the connection's value and never widen it; the effective rule is the intersection, as #898 states. 851 ships the connection layer only. | • ceiling on the connection, narrowed by a later policy (docs)<br>• policy only: #898 has no resource yet, so 851 would ship without a creation control<br>• a per-connection policy file (`.zitadel/policies/idps.json` with a per-slug list): #898 keys social settings by method kind, not by provider | [1](1-resource-model.md#provisioning) |
| Superset or 1:1 for schema-keyed fields | Decided by the epic: "the same Project-level provider connection can support multiple user schemas". The docs follow it: one connection's `claim_mapping` and `verified_claims` may name properties of several schemas, and each schema uses the rows it declares. What stays open is how strictly those fields can be checked, since a typo and a key meant for another schema look alike: a target no referencing schema owns errors, one another schema could own warns, and the server checks less than the CLI. | • superset (epic): one connection reused across schemas, partial mismatches warn, and the row above must be decided<br>• 1:1: one connection per schema even for the same OAuth app; error-grade checks, identity resolution schema-specific by construction, connection config and credentials duplicated; changes the epic's criterion | [1](1-resource-model.md#open-points) |

## Cross-cutting

- **Where auth methods live.** `x-auth-methods` at the user-schema root. The `sso`
  slot gains a `providers` list of connection slugs via a new `sso-auth-method.json`
  — see [`2-auth-method-selection.md`](2-auth-method-selection.md).
- **Capability vs usage.** Schema declares capability, flow declares usage, the
  validator enforces consistency. Mirrors how `password` already works; nothing is
  derived at apply time.
- **Everything references connections by slug**, never by revision id. A new
  connection revision therefore doesn't need an update in user schemas or flows.
- **Where connections live.** `.zitadel/idps/*.json`, synced like schemas and
  flows. See [`1-resource-model.md`](1-resource-model.md).
- **Secrets.** Env refs (`client_secret_env`), never literal values in committed
  config — the `flowEnvRefs` convention (`apps/cli/src/lib/flows/env-refs.ts`,
  both `${VAR}` and `*_env` styles; every syncer enforces it via `assertEnvRefs`,
  `apps/cli/src/lib/sync/syncers.ts:69`). The lifecycle behind it (store, resolution,
  rotation) is an **open question** owned by the deferred secret-store spec;
  immutable server revisions constrain any answer — stored revisions must stay value-free.
  See [`1-resource-model.md`](1-resource-model.md#secrets-and-environments).
- **Vendor knowledge is data.** The goal throughout is to avoid zitadel/zitadel's
  per-vendor Go packages. Protocol is a closed discriminator; vendor is open.
- **Claim mapping is tenant-authored data**, keyed by the tenant's own user-schema
  property names, with superset semantics across schemas — never mapping code.
- **Intra-document rules in the schema; cross-document rules in the validator.**
  Protocol blocks plus `if`/`then` on a `const` discriminator (precise errors, unlike
  `oneOf`); only genuinely cross-resource rules are mirrored between `validate.ts`
  and the server.
- **snake_case, matching flow definitions and `api/openapi/components/`.** User schemas
  are camelCase only because they *are* JSON Schema documents.
- **Reconciled with [`../cli/identity-surface.md`](../cli/identity-surface.md)** — the
  earlier draft of the same resource. See [`1-resource-model.md`](1-resource-model.md).

## Conventions

- **Base the design on what exists.** Undefined or undecided subsystems (the secret
  store, ADR 035 amendments, unwritten engine behaviour) are recorded as open
  questions or constraints — never assumed into the design.

- Every area doc ends with an **Exported requirements** table and opens with an
  **Imported requirements** checklist naming which rows of earlier areas' tables it
  answers. An import with no matching row is a missing row in the exporting doc, not
  a looser citation.
- Schemas and examples embedded in these docs are verified by
  [`packages/config/src/idp-design-docs.test.ts`](../../../packages/config/src/idp-design-docs.test.ts),
  which extracts them from the markdown — edit a doc's JSON block and the test sees it.
  (Runs in CI via `config:test`.)

## Related

- [ADR 007](../../adrs/007-gitops-configuration-surface.md)
- [ADR 035](../../adrs/035-configuration-environments.md)
- [ADR 020](../../adrs/020-credentials-out-of-user-schema.md)
- [`../flowengine/`](../flowengine/)
- [`../cli/`](../cli/)
