# ADR 069: CLI Commands to Enable and Disable Sign-In Methods

> **Status:** Proposed
> **Date:** 2026-10-09
> **Context:** [#1488](https://github.com/zitadel/nextgen/issues/1488)
> **Relates to:** [ADR 007](007-gitops-configuration-surface.md), [ADR 035](035-configuration-environments.md), [ADR 064](064-cli-resource-commands.md)

## Context

A user schema lists the ways its users can sign in under `x-auth-methods`.
The meta-schema allows five entries: `password`, `passkey`, `sso`, `otp` and
`magic_link`. Each has an `enabled` flag, and `sso` also names the identity
providers it offers:

```json
"x-auth-methods": {
  "password": { "enabled": true },
  "passkey": { "enabled": true },
  "sso": { "enabled": true, "providers": ["google"] }
}
```

`zitadel setup` writes this section. After that, the only command that changes
it is `zitadel sso enable --provider <name>` (issue
[#1048](https://github.com/zitadel/nextgen/issues/1048)), which adds a provider.
Turning password or passkey on or off, or removing a provider, means editing the
schema by hand, and a mistake only shows up on the next `plan`, when the flow
validator reports a login flow that asks for a method the schema no longer
enables.

## Decision

### 1. One topic, one command per method

```
zitadel auth-method password enable  [--schema <name>]
zitadel auth-method password disable [--schema <name>] [--force]
zitadel auth-method passkey  enable  [--schema <name>]
zitadel auth-method passkey  disable [--schema <name>] [--force]
zitadel auth-method sso      enable  --provider <name> [--client-id <id>] [--schema <name>]
zitadel auth-method sso      disable --provider <name> [--schema <name>] [--force]
```

- **The method is the noun.** Following ADR 064's resource-first grammar, each
  method is its own command with its own flags. `password` and `passkey` take
  only `--schema`, and `--force` on `disable`. `sso` also takes `--provider`,
  and `sso enable` the provider's credentials. On `sso enable`, `--provider` is
  one of the providers the CLI can set up. On `sso disable` it is any name; one
  that the schema and its flows do not list is reported as unchanged.
  A single command with a `--mode` switch was rejected, because flags such as
  `--client-id` would then mean something for one mode and nothing for the
  others, and help could not show which flags go together.
- **One topic keeps them together.** `zitadel auth-method --help` lists every
  method, so there is one place to look for all of them.
- **The topic is `auth-method`, not `auth` or `auth-factor`.** It matches the
  `x-auth-methods` key it edits. In other developer CLIs, `auth` means the
  CLI's own login (`gh auth login`, `gcloud auth login`), so `zitadel auth`
  stays free in case the CLI gets one. `auth-factor` was considered and dropped,
  because SSO is a sign-in method but not a factor.
- **`--schema` chooses the user schema** when the Project has more than one,
  with the same rules on every command.

### 2. What each command edits

The commands change local files. The one exception is `sso enable`, which
also stores the provider's client id and secret on the project as variables,
so they never sit in a file. Schema and flow changes are published by the
commands that ship configuration edits, and the result lists them as
`next_commands`. Today those
are `plan` and `apply` (ADR 007). [ADR 035 §CLI](035-configuration-environments.md)
removes `plan` and replaces `apply` with `deploy`. When that lands,
`next_commands` changes with it, and these commands do not change.

- **password and passkey** set `x-auth-methods.<method>.enabled` in the schema
  and edit nothing else. Login flows are not edited, because adding or removing
  a password step or a passkey action changes the shape of a journey that the
  developer owns.
- **sso enable** does what `sso enable` did before this ADR: it creates or
  reuses the connection file, publishes the client id and secret as variables,
  adds the provider to the schema, and adds it to the login flows. The secret
  is prompted for or read from stdin, never taken as a flag.
- **sso disable** removes the provider from `x-auth-methods.sso.providers` and
  from every step's `sso_providers` in the flows that run against the schema.
  When no provider is left, `sso` is set to `{ "enabled": false }`. The routes
  and steps that `sso enable` added stay in the flow: without a provider they
  are never reached, and they come back into use if a provider is enabled
  again. The connection file and its stored credentials are kept, so enabling
  the provider again does not ask for them.

Files are rewritten with sorted keys. Running a command twice is safe: a method
already in the requested state is reported as unchanged, and nothing is
written.

Every result lists its follow-ups in `next_commands`, with `plan` and `apply`
only when a file changed. The schema name comes from a file name and `--cwd`
from the user. When either would need shell quoting, `next_commands` is left
empty, because quoting differs between POSIX shells, PowerShell and cmd.exe.
The same commands are always given as argument lists: `data.next_args` on
success, and `details.retry_args` and `details.suggested_args` on a refusal. A
follow-up carries `--cwd` when the run did, and a dry run's suggestions keep
`--dry-run`.

### 3. Refusals

Every refusal below happens before anything is written or published, including
under `--dry-run`, so a dry run fails where the real run would for any of them.

- **A flow would break.** Before any change, the command validates each login
  flow that runs against the schema, using the schema and flows as they would
  be after the change. It uses the validator `plan` uses. If the change adds an
  error, such as a step that still collects `x-auth-methods#password` or still
  offers a `passkey` action, the command refuses and names each flow and step.
  Errors the flow already had do not count. A flow belongs to the schema when
  its `user_schema` is the id `.zitadel/state.json` records for the schema or
  the id that one replaced; otherwise when it is the schema's `$id`; and, for a
  schema with no `$id`, when it ends in `/<file name>.json`. Before the
  first `apply` this can match more flows than `plan` does, so a command may
  refuse a change `plan` would accept, but never the reverse.
- **A flow cannot be checked.** A flow file that does not match the flow
  schema, or that has a structural error such as a purpose pointing at a
  missing step, is not checked for sign-in methods by the validator. The
  command cannot tell whether such a flow still uses the method, and `plan`
  would reject it once the changed schema re-pins it, so every command that
  would change the schema or a flow refuses until the flow is fixed.
- **No way to sign in would be left.** Disabling the schema's last enabled
  method is guarded. Only password, passkey and SSO with at least one
  well-formed provider count. This guard is CLI policy, not a server rule. The
  server accepts a schema with every method disabled, because a schema whose
  users are only created and managed through the API never needs a sign-in
  method. Most of the time, though, it is a mistake, so it is guarded the way
  [ADR 064 §10](064-cli-resource-commands.md) guards destructive verbs. In a
  terminal the command asks for confirmation, and declining ends as `skipped`.
  Non-interactively, and under `--dry-run`, it refuses unless `--force` is
  passed, and the refusal carries the exact command to re-run with `--force`,
  plus commands that enable another method instead.
  `--force` overrides this guard only. The other refusals protect against a
  `plan` or `apply` that would fail, so no flag overrides them, and they are
  checked before the prompt.

  The guard reads the schema alone. Whether anyone can actually sign in also
  depends on the active flows: a method is only reachable when the schema
  enables it and an active flow's login journey offers it. `password` and
  `passkey` cannot remove a method that an active flow offers, because the flow
  refusal above stops them first. `sso disable` removes the provider from the
  flows as well as the schema, so for it the guard is what stops the last
  provider going unnoticed. Either way, a schema can still end up with methods
  that no flow offers, for example after a flow edit. To make that visible,
  every run warns when, after the change, the schema enables a method but no
  active flow offers any of them.

- **Password needs an identifier.** Enabling password on a schema without
  `x-identifier` is refused, because the server rejects that combination and
  `plan` does not catch it.
- **Values that are not the right shape are refused, not overwritten.** This
  covers an `x-auth-methods` that is not an object; the entry the command
  edits (`sso` for the sso commands) when it is not an object or has no
  boolean `enabled`; an `sso.providers`, or a step's `sso_providers`, that is
  not a list; and a schema that points at an external URL instead of holding
  its own methods.

### 4. Enabling does not make a method appear

Enabling passkey on a schema whose active flows offer no passkey sign-in
changes nothing on the sign-in screen. The command reports this in the
envelope's `warnings` and in `data.not_offered`, and does not fail, because
enabling the method first and editing the flow second is a normal order of work.

### 5. `otp` and `magic_link` come later

The meta-schema already accepts `otp` and `magic_link`, but the login engine
cannot serve them yet. They get `zitadel auth-method otp enable|disable` and
`zitadel auth-method magic_link enable|disable` when it can, as new commands
under the same topic with whatever flags they need. Until then they are not
commands, and they do not count as a way to sign in for the guard in §3.

### 6. `sso enable` becomes a deprecated alias

`zitadel sso enable` keeps working and runs `zitadel auth-method sso enable`
with the same flags. Each run that gets past flag parsing reports a
deprecation warning that names the new command. CLI output, `setup`'s suggestions and the agent contract
(`SKILL.md`) point at the new command. Removing the alias is a separate change.

## Consequences

- Every sign-in method is turned on or off from one topic, with no JSON
  editing, and each command only accepts the flags that apply to it.
- A change that would break `plan` or `apply` is caught before the file is
  written.
- Disabling a method that a flow uses is still two steps: edit the flow, then
  run the command. A later decision may let the commands rewrite the shipped
  default flow; hand-edited flows would stay the developer's to change.
- `zitadel auth` is left unused.
- Adding `otp`, `magic_link` or a new SSO provider adds commands or provider
  settings without changing the existing commands.
