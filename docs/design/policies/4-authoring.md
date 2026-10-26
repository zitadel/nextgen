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
  "config": { "min_length": 12 }
}
```

- `zitadel setup` writes and publishes the password policy file with
  `"config": {}`, which enforces nothing, and puts a minimum length into it
  only when the developer gives one: in the wizard, whose input shows an
  example but preselects nothing, or with `--password-min-length`
  ([#1450](https://github.com/zitadel/nextgen/issues/1450)). The CLI chooses no
  value, for the reason the server has none
  ([ADR 066, No server defaults](../../adrs/066-operation-policies.md#no-server-defaults));
  the file makes the policy easy to find and to set. Without a value only the
  domain guards (non-empty, at most 64 code points) apply. An existing policy
  file holds a project's chosen rules: setup refuses it, and `--force` keeps
  it and publishes it to the new project instead of replacing it; a minimum
  given then goes into it, and 0 removes its `min_length`. Against a
  server without the policy endpoints, setup warns and writes no policy.
- `zitadel deploy` carries the files in the release bundle (`policies`,
  [ADR 035](../../adrs/035-configuration-environments.md)). The release build
  publishes a changed config as a new revision of the operation's policy and
  pins it; an unchanged one reuses the newest revision. Like an IdP
  connection, a policy keeps one id while the server keeps its revisions.
- `zitadel policies list` and `zitadel policies get <id|operation>` read
  policies back at their newest revision. Per
  [ADR 064](../../adrs/064-cli-resource-commands.md) a configuration resource
  gets `list` and `get` only; the file is the writer.
- What applies follows the release (ADR 035,
  [ADR 066](../../adrs/066-operation-policies.md#where-the-catalog-lives-and-how-an-operation-is-added)):
  a sign-in or sign-up served a release that pins a flow gets the policy that
  release pins, and none when it pins none, with no fallback to a stored
  revision. Deleting the file and deploying switches the policy off there,
  with the confirmation `deploy` asks for every removal, and a release that
  was only built changes nothing. A request that resolves no release (a
  password set through the API, or anything before the first deploy) still
  gets the newest revision, as for every kind
  ([#1616](https://github.com/zitadel/nextgen/issues/1616)), so
  `"config": {}` is how to switch the rules off for those too.

A file is validated locally against the operation-typed schema before
anything is sent: an unknown setting, a value outside the template's bounds or
a file not named after its operation fails `deploy`, and the server's config
rules (a minimum above the maximum) fail the release build with `rel.invalid`.
There are no warnings: a value within the bounds is the project's choice.

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
