# Authoring

## `.zitadel/policies/` and the CLI

Instances are files the developer owns: `.zitadel/policies/<operation>.json`,
one per guarded operation and named after it. A file is the publish body
(`POST /policies`) plus the editor `$schema`, which points at the
`policy.json` meta-schema generated from the OpenAPI publish union:

```json
{
  "$schema": "../meta/policy.json",
  "operation": "auth.factor.password.set",
  "config": { "min_length": 15 }
}
```

- `zitadel setup` offers the file above as a starter
  ([#1450](https://github.com/zitadel/nextgen/issues/1450)). 15 is the NIST
  SP 800-63B minimum for a single-factor password, and #898's former server
  default ([ADR 066, No server defaults](../../adrs/066-operation-policies.md#no-server-defaults)).
  Its values are the CLI's suggestion, not a server default, and a developer
  who skips it has no password policy: only the domain guards (non-empty, at
  most 64 code points) apply.
- `zitadel plan` diffs the file against the stored revision and
  `zitadel apply` publishes a new one through `POST /policies`. Both run the
  same sync engine as schemas, flows and branding, with the `policy` kind
  registered next to them (`PolicySyncer` in `apps/cli/src/lib/sync/`). Like
  an IdP connection, a policy keeps one id while the server keeps its
  revisions, so an edit publishes under the same policy.
- `zitadel policies list` and `zitadel policies get <id|operation>` read
  policies back at their newest revision. Per
  [ADR 064](../../adrs/064-cli-resource-commands.md) a configuration resource
  gets `list` and `get` only; the file is the writer.
- A policy cannot be deleted: its revisions stay for releases and records.
  Removing the file is reported by `plan` and `apply` and leaves the policy in
  place; `"config": {}` switches every rule off.

A file is validated locally against the operation-typed schema before it is
sent: an unknown setting or a value outside the template's bounds fails
`plan`, and the server's config rules (a minimum above the maximum) fail
`apply`. There are no warnings: a value within the bounds is the project's
choice.

## Testing (not built yet)

CEL has no `opa test`. Two things replace it:

- A test file next to the instance.
  `.zitadel/policies/auth.factor.password.set.test.json` holds a table of
  `(config, context, expected decision)`. `zitadel policies test` runs it.
  The shape is the one every policy-as-code CLI converges on (`gator verify`,
  `kyverno test`, `sentinel test`, `fga model test`).
- A server-side dry run. `POST /policies/{operation}/evaluate` takes an
  explicit context and an optional instance, returns the decision, and has no
  side effects. The CLI test command calls it. Once scoped instances land the same endpoint
  answers "which instance wins for this request and why", which a
  most-specific-wins resolution model needs (Okta ships a policy simulator for
  exactly this reason).

The CLI never evaluates CEL itself: it is TypeScript, there is no official CEL
implementation for JavaScript, and a second evaluator would drift.

Zitadel's own templates are covered by Go tests in the server: for every
template, a table of contexts with the expected violations.
