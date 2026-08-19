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

The epic decomposes into seven areas, roughly in dependency order, one doc
per area.

| # | Area | Doc |
|---|---|---|
| 1 | **IdP resource model** — declarative connection, syncer, schema, secrets, catalog | [`1-resource-model.md`](1-resource-model.md) |
| 2 | **Auth-method selection** — `x-auth-methods.sso`, provider slugs, flow cross-validation | [`2-auth-method-selection.md`](2-auth-method-selection.md) |
| 3 | **Social login flow** — the SSO ceremony, identity resolution, conflicts, recovery | [`3-social-login-flow.md`](3-social-login-flow.md) |
| 4 | **Provider setup sub-journey** — callback URI surfacing, credential capture, preview | [`4-cli-provider-setup.md`](4-cli-provider-setup.md) |
| 5 | **Post-claim CLI menu** — Project menu, Configure submenu, "Sign-in methods" | [`5-post-claim-menu.md`](5-post-claim-menu.md) |
| 6 | **Test-sign-in journey** — distinguishing provider misconfiguration from journey failure | [`6-test-sign-in.md`](6-test-sign-in.md) |
| 7 | **Console read-only views** — auth methods per latest schema version, existing connections | [`7-console-views.md`](7-console-views.md) |

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

- Every area doc opens with an **Imported requirements** checklist naming which rows of
  [`1-resource-model.md`](1-resource-model.md#exported-requirements) (and later tables) it
  answers.
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
