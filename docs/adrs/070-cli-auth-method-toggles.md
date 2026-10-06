# ADR 070: CLI Commands to Enable and Disable Password and Passkey Sign-In

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

### 1. Two verbs under an `auth` topic

```
zitadel auth enable  --mode password [--mode passkey] [--schema <name>]
zitadel auth disable --mode passkey  [--schema <name>]
```

- **`auth` is a topic, not a resource.** ADR 064's `<resource> <verb>`
  grammar is for runtime resources on the server. This edits a local
  configuration file, like `sso enable`, so it follows that command's shape
  rather than ADR 064's.
- **`--mode` is repeatable and required.** It takes `password` or `passkey`.
  Several methods change in one run, and naming the method is required for the
  same reason `sso enable` requires `--provider`: a command that guesses which
  method to switch off is not one to trust.
- **`--schema` chooses the user schema** when the Project has more than one,
  with the same rules as `sso enable`.
- **SSO is not a mode.** Enabling a provider needs credentials and a
  connection file, so it stays `sso enable`.

### 2. It edits the schema file and nothing else

The command sets `x-auth-methods.<mode>.enabled` in the selected schema and
writes the file back. Other keys in the method's object, and the other
methods, are left as they are. Nothing is sent to the server: the change goes
out through `plan` and `apply` like any other configuration edit (ADR 035), and
the result lists those two as `next_commands`.

Running it twice is safe. A method already in the requested state is reported
as unchanged and the file is not rewritten.

Login flows are not edited. Adding or removing a password step or a passkey
action changes the shape of a journey, and doing that automatically would
overwrite choices the developer made in the flow file.

### 3. It refuses changes that `plan` would reject

Before writing anything, the command validates every login flow that runs
against the schema, using the schema as it would be after the change, with the
same validator `plan` uses. If the change introduces an error, such as a step
that still collects `x-auth-methods#password` or offers a `passkey` action,
nothing is written. The error names each flow and step, so the developer knows
what to edit first.

It also refuses to disable the last method a schema has. With password,
passkey and SSO all off, nobody can sign in.

### 4. Enabling does not make a method appear

Enabling passkey on a schema whose flow offers no passkey action changes
nothing on the sign-in screen. The command says so as a warning and does not
fail, because enabling the method first and editing the flow second is a
normal order of work.

## Consequences

- Password and passkey can be switched without editing JSON, and a change
  that would break `plan` is caught before the file is written.
- Disabling a method a flow uses is still two steps: edit the flow, then run
  the command. A later decision can let the command rewrite the shipped
  default flow, but not hand-edited ones.
- The command contract (`--mode`, the envelope, the refusals) goes into
  `SKILL.md` alongside `sso enable`.
