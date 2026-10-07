# ADR 068: CLI Commands to Enable and Disable Password and Passkey Sign-In

> **Status:** Proposed
> **Date:** 2026-10-07
> **Context:** [#1488](https://github.com/zitadel/nextgen/issues/1488)
> **Relates to:** [ADR 007](007-gitops-configuration-surface.md), [ADR 035](035-configuration-environments.md), [ADR 064](064-cli-resource-commands.md)

## Context

A user schema says which sign-in methods its users have through
`x-auth-methods`: `password.enabled` and `passkey.enabled` today, beside the
`sso` entry `zitadel sso enable` writes. Turning one of them on or off means
opening `.zitadel/schemas/<name>.json` and editing that object by hand, and a
mistake only shows up on the next `plan`, when the flow validator reports a
login flow that still asks for a method the schema no longer enables.

`sso enable` already gives SSO a command. Password and passkey have none.

## Decision

### 1. Two verbs under an `auth-factor` topic

```
zitadel auth-factor enable  --mode password [--mode passkey] [--schema <name>]
zitadel auth-factor disable --mode passkey  [--schema <name>] [--force]
```

- **The topic is `auth-factor`, not `auth`.** In other developer CLIs, `auth`
  means the CLI's own login: `gh auth login`, `gcloud auth login`, `vercel
login`. A developer who reads `zitadel auth enable` could take it to mean
  "let this CLI sign in", which is not what it does. `zitadel auth` stays free
  in case the CLI later gets a login of its own. A nested `auth factor` would
  not solve this, because it still takes the `auth` topic. One hyphenated word
  does, in the same way `flow-definitions` is spelled.
- **It is a factor.** Password and passkey are what a user proves sign-in with,
  so "factor" names the thing being turned on or off. "Method" would also
  describe SSO, which is not part of this command.
- **`auth-factor` is a topic, not a resource.** ADR 064's `<resource> <verb>`
  grammar is for runtime resources on the server. This command edits a local
  configuration file, like `sso enable`, so it follows that command's shape
  rather than ADR 064's.
- **`--mode` is repeatable and required.** It takes `password` or `passkey`,
  and several modes can change in one run. Naming the mode is required for the
  same reason `sso enable` requires `--provider`: a command that guesses which
  method to switch off is not one to trust.
- **`--schema` chooses the user schema** when the Project has more than one,
  with the same rules as `sso enable`.
- **SSO is not a mode.** Enabling a provider needs credentials and a
  connection file, so it stays with `sso enable`.

### 2. It edits the schema file and nothing else

The command sets `x-auth-methods.<mode>.enabled` in the selected schema and
writes the file back. The other methods keep their values. The file is
rewritten with sorted keys, as `sso enable` does. Nothing is sent to the
server. The change is published by whatever ships configuration edits, like
any other edit, and the result lists those commands as `next_commands`. Today
those commands are `plan` and `apply` (ADR 007). [ADR 035
§CLI](035-configuration-environments.md) removes `plan` and replaces `apply`
with `deploy`. When that lands, `next_commands` changes with it, and this
command does not change.

Running it twice is safe. A mode already in the requested state is reported as
unchanged, and the file is not rewritten.

Login flows are not edited. Adding or removing a password step or a passkey
action changes the shape of a journey, and doing that automatically would
overwrite choices the developer made in the flow file.

### 3. It refuses changes that would fail later

Every refusal happens before anything is written, including under `--dry-run`.

- **A flow would break.** Before disabling, the command validates each login
  flow that runs against the schema, using the schema as it would be after the
  change. It uses the validator `plan` uses. If the change adds an error, such
  as a step that still collects `x-auth-methods#password` or still offers a
  `passkey` action, the command refuses and names each flow and step. Errors
  the flow already had do not count. The command matches flows to a schema by
  the published id, by the schema's `$id`, or by file name, which is broader
  than `plan`'s matching before the first `apply`. So it can be stricter than
  `plan`, but never looser.
- **A flow cannot be checked.** The validator skips the sign-in method rules
  for a flow with a structural error, such as a purpose that points at a
  missing step. The command cannot tell whether such a flow still uses the
  method, so it refuses until the flow is fixed.
- **No factor would be left.** Disabling the schema's last enabled way to
  sign in is guarded. Only password, passkey and SSO with at least one
  provider count. `otp` and `magic_link` are allowed by the meta-schema but
  not supported by the login engine yet, so they do not count. This guard is
  CLI policy, not a server rule. The server accepts a schema with every method
  disabled, because a schema whose users are only created and managed through
  the API never needs a sign-in method. Most of the time, though, it is a
  mistake, so it is guarded the way
  [ADR 064 §10](064-cli-resource-commands.md) guards destructive verbs. In a
  terminal the command asks for confirmation, and declining ends as
  `skipped`. Non-interactively, and under `--dry-run`, it refuses unless
  `--force` is passed, and the refusal carries the exact command to re-run
  with `--force`. `--force` overrides this guard only. The other refusals
  protect against a `plan` or `apply` that would fail, so no flag overrides
  them, and they are checked before the prompt.

  The guard reads the schema alone. Whether anyone can actually sign in also
  depends on the active flows: a factor is only reachable when the schema
  enables it and an active flow offers it. The command cannot remove a factor
  that an active flow offers, because the flow refusal above stops it first.
  So the only way to lose every reachable factor is to edit a flow, which this
  command never does. To make that visible, every run warns when, after the
  change, no active flow offers any factor the schema enables.

- **Password needs an identifier.** Enabling password on a schema without
  `x-identifier` is refused, because the server rejects that combination and
  `plan` does not catch it.

### 4. Enabling does not make a factor appear

Enabling passkey on a schema whose active flows offer no passkey action changes
nothing on the sign-in screen. The command reports this in the envelope's
`warnings` and in `data.not_offered`, and does not fail, because enabling the
factor first and editing the flow second is a normal order of work.

## Consequences

- Password and passkey can be switched without editing JSON, and a change
  that would break `plan` or `apply` is caught before the file is written.
  The same refusals apply to `deploy` once ADR 035 replaces `apply`.
- Disabling a factor that a flow uses is still two steps: edit the flow, then
  run the command. A later decision can let the command rewrite the shipped
  default flow, but not hand-edited ones.
- `zitadel auth` is left unused.
- The command contract (`--mode`, the envelope, the refusals) goes into
  `SKILL.md` alongside `sso enable`.
