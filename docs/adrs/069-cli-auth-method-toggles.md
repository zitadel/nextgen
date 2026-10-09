# ADR 069: CLI Commands to Enable and Disable Sign-In Methods

> **Status:** Proposed
> **Date:** 2026-10-09
> **Context:** [#1488](https://github.com/zitadel/nextgen/issues/1488)
> **Relates to:** [ADR 064](064-cli-resource-commands.md)

## Context

A user schema lists how its users can sign in, under `x-auth-methods`:

```json
"x-auth-methods": {
  "password": { "enabled": true },
  "passkey": { "enabled": true },
  "sso": { "enabled": true, "providers": ["google"] }
}
```

`zitadel setup` writes this. Afterwards, the only command that changes it is
`zitadel sso enable`, which adds an SSO provider. Everything else means editing
the JSON by hand.

## Decision

### 1. One command per sign-in method

| Command                                                                          | What it does                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `zitadel auth-method password enable`                                            | Turns password sign-in on                                                                        |
| `zitadel auth-method password disable`                                           | Turns password sign-in off                                                                       |
| `zitadel auth-method passkey enable`                                             | Turns passkey sign-in on                                                                         |
| `zitadel auth-method passkey disable`                                            | Turns passkey sign-in off                                                                        |
| `zitadel auth-method sso enable --provider google`                               | Adds Google, prompting for the client id and secret                                              |
| `zitadel auth-method sso enable --provider google --client-id <id> < secret.txt` | Adds Google without prompts, for scripts: the id as a flag, the secret on stdin, never as a flag |
| `zitadel auth-method sso disable --provider google`                              | Removes Google                                                                                   |

Every command also takes these flags:

| Flag              | Meaning                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `--schema <name>` | The user schema to change. Needed only when the project has more than one. |
| `--dry-run`       | Shows what would change, without changing anything.                        |
| `--force`         | `disable` commands only: allows removing the last way to sign in (§3).     |

`google` is the only provider today. Each new provider is another value for
`--provider`, not a new command.

- **Each method is its own command**, so each command only has the flags it
  needs. `sso` needs a provider and credentials; `password` and `passkey` need
  nothing. One command with a `--mode` switch was rejected, because flags such
  as `--client-id` would then apply to some modes and not others.
- **The topic is `auth-method`**, after the `x-auth-methods` field it edits.
  It is not `auth`, because other CLIs use `auth` for logging the CLI itself
  in (`gh auth login`), and that name should stay free.

### 2. What each command changes

- **`password` and `passkey`** turn the method on or off in the schema. They
  do not change the login flow.
- **`sso enable`** adds the provider to the schema and to the login flow, and
  creates the provider's connection. It stores the client id and secret on the
  project, so they are never written to a file.
- **`sso disable`** removes the provider from the schema and the login flow.
  It keeps the connection and its credentials, so enabling the provider again
  does not ask for them.

Apart from the credentials, the commands only change local files. The changes
go live with the next `zitadel apply`, like any other configuration change.

Running a command twice is safe: the second run changes nothing.

### 3. When a command refuses

A command refuses, and changes nothing, when the change would leave the
project broken:

- **A login flow still uses the method.** For example, disabling password while
  the flow still asks for a password. Change the flow first, then run the
  command.
- **A login flow has errors**, so the command cannot tell what the change would
  do to it. Fix the flow first.
- **Password would be enabled on a schema with no `x-identifier`.** The server
  needs it to find the user a password belongs to.
- **A value is not what the command expects**, for example `"enabled": "yes"`.
  The command does not overwrite something it does not understand.

Removing the last way to sign in is allowed, but only on purpose. The server
allows a schema with no sign-in method, for users who are only managed through
the API. The command asks for confirmation in a terminal, and needs `--force`
in a script.

### 4. Turning on password or passkey does not change the login screen

The schema says which methods are allowed. The login flow decides which screens
and buttons users actually see. `sso enable` changes both, so the provider
appears. `password` and `passkey` only change the schema.

So enabling passkey on a project whose flow has no passkey button changes
nothing on the login screen. The command warns when this happens, and does not
fail, because a developer may enable the method first and add it to the flow
afterwards.

### 5. OTP and magic link come later

The schema already accepts `otp` and `magic_link`, but the login screen cannot
use them yet. They get their own `auth-method` commands once it can.

### 6. `sso enable` stays as a deprecated alias

`zitadel sso enable` keeps working and does the same as
`zitadel auth-method sso enable`. It prints a warning that names the new
command. Removing it is a separate change.

## Consequences

- Every sign-in method is turned on or off with one command, without editing
  JSON.
- A change that would break the project is refused before anything is written.
- Turning on password or passkey can still need a flow change before users see
  it (§4).
