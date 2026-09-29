# Authoring

## `.zitadel/policies/` and the CLI

Instances are files the developer owns: `.zitadel/policies/<operation>.json`,
one per guarded operation, with the editor `$schema` pointing at the
`policy.json` meta-schema generated from the OpenAPI component.

- `zitadel setup` scaffolds the `user.password.save` instance from
  `packages/config/defaults/default-password-policy.json` (the template
  defaults, spelled out) and publishes it as revision 1, so `plan` starts from
  a known server state.
- `zitadel plan` diffs the file against the stored revision and
  `zitadel apply` publishes a new one through `POST /policies`. Both run the
  same sync engine as schemas, flows and branding, with the `policy` kind
  registered next to them (`PolicySyncer` in `apps/cli/src/lib/sync/`).
- `zitadel policies list` and `zitadel policies get <id>` read revisions back.
  Per [ADR 064](../../adrs/064-cli-resource-commands.md) a configuration
  resource gets `list` and `get` only; the file is the writer.

A file is validated locally against the operation-typed schema before it is
sent: an unknown setting, a value outside the template's bounds, or a fixed
setting fails `plan`. A value below a setting's `x-recommended-minimum`
(`min_length` under 15) publishes, with a warning on the plan and again on
apply.

## Testing (not built yet)

CEL has no `opa test`. Two things replace it:

- **A test file next to the instance.**
  `.zitadel/policies/user.password.save.test.json` holds a table of
  `(config, context, expected decision)`. `zitadel policies test` runs it.
  The shape is the one every policy-as-code CLI converges on (`gator verify`,
  `kyverno test`, `sentinel test`, `fga model test`).
- **A server-side dry run.** `POST /policies/{operation}/evaluate` takes an
  explicit context and an optional instance, returns the decision, and has no
  side effects. The CLI test command calls it. Once scoped instances land
  ([#1264](https://github.com/zitadel/nextgen/pull/1264)) the same endpoint
  answers "which instance wins for this request and why", which a
  most-specific-wins resolution model needs (Okta ships a policy simulator for
  exactly this reason).

The CLI never evaluates CEL itself: it is TypeScript, there is no official CEL
implementation for JavaScript, and a second evaluator would drift.

Zitadel's own templates are covered by Go tests in the server: for every
template, a table of contexts with the expected violations.
