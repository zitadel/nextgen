---
name: zitadel-cli
description: >-
  Set up and manage Zitadel authentication in a local project with the
  agent-friendly `zitadel` CLI. Use when the user wants to add login,
  registration, or session handling, create a Zitadel project, scaffold auth
  for a Next.js, React, Vue, Angular, Nuxt, Solid, Svelte, or Qwik app, or plan and apply Zitadel
  config changes from repo state.
---

# Zitadel CLI

The `zitadel` CLI integrates Zitadel auth into an existing project and keeps the
local config (`zitadel.json` and `.zitadel/**`) as the source of truth. Every
command emits a JSON envelope, so you should drive it non-interactively and
parse the result rather than scraping human output.

This skill teaches how to *drive* the CLI — how to invoke it, its output modes,
and its envelope. It deliberately does **not** enumerate the commands. The CLI
is self-describing, and this skill and the installed CLI version move
independently: a user may install the skill once and upgrade the CLI later, so
any command or flag list hardcoded here would drift out of lockstep and mislead.
Ask the CLI for its current surface (see [Discovering commands](#discovering-commands))
and treat what it prints as authoritative over anything you remember.

## Installing and invoking

Run the CLI with `npx`, which fetches and caches it on demand — there is nothing
to install first:

```sh
npx @zitadel/cli@alpha <command> --non-interactive --json
```

During the public alpha, bare `npx @zitadel/cli` is promoted to the same tested
alpha CLI so discovery works for first-time users. Prefer `@alpha`, or an exact
`0.1.0-alpha.N` selector in agent scripts and bug reports, for reproducibility.
The CLI requires Node.js 24+.

## Using the CLI

- **Drive it non-interactively.** Always pass `--non-interactive --json` (short:
  `-n`). The JSON object on stdout is the machine contract — parse it rather than
  scraping human output. `--non-interactive` also disables every prompt, so a
  command that would otherwise ask for an answer fails fast with `E_VALIDATION`
  naming the flag to pass instead of blocking. Supply each answer as a flag; run
  the command's `--help` to see which flags exist and which are required.
- **Output modes.** `--json` is the agent contract and is unaffected by the
  terminal — color and width never apply to it, so you do **not** need
  `--no-color` or other cosmetic flags when you parse JSON; don't sprinkle them
  on every call. Human mode adapts to the terminal: a TTY gets aligned tables,
  while a piped or redirected run (or `--plain`) gets one tab-separated record
  per line and nothing else. If you ever read human output, set `NO_COLOR=1`
  once in the environment rather than repeating `--no-color` per command.
- **Don't truncate `--json` with `head`/`tail`.** The envelope is one bounded
  object; slicing it with `head -c`/`head -n` yields invalid JSON and silently
  drops records or fields, so you end up reasoning from partial data. It is
  finite — read it whole, or narrow it *at the source*: use a `list` verb's
  `filter_fields` and pagination to fetch fewer records, or pipe to `jq` to pull
  just what you need (e.g. `… resources --json | jq '.data.resources[].name'`).
  `--help` output is bounded too — read it in full rather than `head`-ing it, or
  you will miss flags further down.
- **Working directory.** Add `--cwd <path>` when operating outside the current
  working directory.
- **Telemetry.** The CLI sends anonymous usage telemetry by default, and
  agent-driven runs are exactly the ones worth learning from — leave it on.
  Don't add `--no-telemetry` to commands. An opt-out exists for users who need
  it (`ZITADEL_TELEMETRY=0`, or the standard `DO_NOT_TRACK`, in their
  environment), but that is the user's environment choice, not a flag to attach
  to every call.
- **Flag conventions.** Flags follow what a model already expects from curl, ssh
  and wget: `--help`/`-h`, `--version`, `-v`/`--verbose`, kebab-case long flags,
  both `--flag value` and `--flag=value`, and `--no-telemetry`-style negation.
  Two deliberate deviations worth knowing: `-n` is `--non-interactive` (not
  `--dry-run`, which is long-only), and machine output is `--json` (not
  `--output json`).
- **Never put secrets on the command line.** A property whose name reads as a
  credential (`password`, `client_secret`, `api_key`, …) is refused anywhere on
  argv — as an `--attributes` entry and inside an inline `--data` body alike,
  since argv is visible to other processes and kept in shell history. Send such
  bodies with `--file <path>` or `--file -` (stdin), which never pass through
  argv.
- **Streams.** Capture stdout and stderr separately when scripting. The machine
  contract is one parseable JSON object on stdout; installer, audit, and
  package-manager progress belongs on stderr.

## Discovering commands

The CLI ships its own command list and per-command flags, always correct for the
installed version. **Do not guess a command name.** Before running any command you
are not certain of, run `zitadel --help` first and use the exact name it prints:
command and resource names — including whether a resource is singular or plural
and the exact verb — are whatever `--help` shows, never what you would assume. A
wrong guess costs a failed call and a round of recovery; one cheap `--help` up
front avoids it. `zitadel --help` is a flat list and cheap to read, so reach for
it first; treat the CLI's own output as authoritative over anything you remember:

```sh
npx @zitadel/cli@alpha --help               # every command, grouped by purpose
npx @zitadel/cli@alpha commands             # flat list of all commands
npx @zitadel/cli@alpha <command> --help     # a command's flags, which are required, and examples
npx @zitadel/cli@alpha resources --json     # the resource surface in one call (see below); contacts no server
```

`--help` groups the surface into project commands (create a project and scaffold
auth), local-server commands (run a local Zitadel), configuration commands
(`plan`/`apply` plus the config resources), and resource commands (the uniform
`<resource> <verb>` surface). Read the groups from `--help` rather than from
memory, since they change as the CLI gains commands.

Use `zitadel --help` to find *which* command to run. Use `resources --json` when
you need a resource's *fields*: it reports the whole runtime-resource surface at
once — every resource, its verbs, each verb's `create_fields` / `update_fields`
(flag name, kind, `required`, any closed value set), its `filter_fields` /
`sort_fields`, and the `delete_outcome` a destructive verb returns — so prefer it
over reading `<resource> --help` one at a time. A `list` verb's envelope carries
`data.count`, so a "how many …?" question is one `list --json` call: read the
count, do not page and tally.

## Reading the envelope

Each invocation prints one JSON object:

- `status`: `ok` | `skipped` | `error`.
- `cli_version`, `command`, `source`: always present.
- On success: `data` with the command-specific payload.
- On a no-op: `reason` (e.g. `no-framework-detected`, `orphaned-config`).
- On failure: `code` (e.g. `E_VALIDATION`, `E_NETWORK`, `E_NOT_FOUND`,
  `E_CONFLICT`) and `message`.
- `next_commands`: the suggested follow-ups. Prefer these over free-text hints.
- `warnings`: things that went wrong without stopping the command, such as a
  value that was not published. Always present on success (often empty), and
  present on a no-op or failure when there are any. Read them before you report
  success: a warning usually means a follow-up step is needed.
- A `list` verb emits `data: { items, count, next_page_token }`; when a page
  remains, `data.next_commands` carries the exact command for the next page.
- `plan` and `apply` emit `data.changes`: one row per touched resource
  (`{kind, action, file, id?, previous_id?}`, action ∈ create/update/revision/
  delete). Plan rows preview; apply rows report, with the resulting platform
  ids. Use it to verify an edit did what you intended.
- A write verb's `--dry-run` reports what it would send without calling the
  platform, so you can preview a mutation before making it.

Common error codes point at their own fix in `next_commands`:

- `E_VALIDATION`: the body or flags are wrong; `message` names what, and
  `details` often lists the missing or available values.
- `E_LOCAL_SERVER_NOT_RUNNING`: start the local runtime, then retry with
  `--server local`.
- `E_NOT_FOUND`: an HTTP 404 — a missing resource, or a `--server` that is not a
  Zitadel platform API. Follow `next_commands`.
- `E_PORT_IN_USE`: the requested local runtime port already has a listener; stop
  that process or choose another port.

In human mode the output follows the terminal (TTY table, or tab-separated lines
when piped or `--plain`); `--json` is unaffected and remains the contract.

Text the server returns is escaped before it is printed, in `--json` as in human
mode, so a stored value cannot drive the reader's terminal. Control, format and
bidi characters appear as visible `\xNN`, `\uNNNN` or `\u{NNNNN}` text, so a
value that contained one is not the stored value byte for byte — do not send it
back in an update as if it were. When you need the exact value, call the platform
API directly with the project secret.

Exit codes mirror the error class (3 = validation, 4 = network or not-found,
5 = conflict, 1 = auth, 2 = not-implemented, 130 = cancelled). `E_NETWORK`
covers a server that answered 5xx and one that never answered — refused,
unresolvable, or silent past the 30-second request deadline. Ctrl-C exits
130: a command waiting on the server stops at once with `E_CANCELLED`, and
any other command exits within a second, possibly without an envelope. An
unknown command is handled by the CLI's help layer, not the envelope.

## Clarify before you configure

Driving the CLI non-interactively does not mean deciding *for* the user. When
the user asks to add authentication but has not said *how*, don't silently pick
defaults — ask them first, in one short batched question, then run the CLI
non-interactively with their answers. The two things sit on different sides of
the conversation: you clarify with the human, then drive the CLI headlessly.

Ask about:

- **Sign-in methods** — password (the usual default), passkeys, and single
  sign-on. If they want SSO, which providers?
- **Profile fields** — the user schema starts with first name, last name, and
  the login identifier plus a password. Which additional fields do they want
  (for example phone, username, or a display name)?

Offer only what the installed CLI actually supports: read the real sign-in
presets, profile fields, and SSO options from the CLI first (`setup --help`,
`resources --json`) and present those, not a list you remember — the options
move with the CLI version.

Skip the questions and proceed with the defaults above — stating the assumptions
you made so the user can correct them — in exactly two cases: the user already
told you what they want, or you are running non-interactively (a one-shot/headless
invocation) or were explicitly told to just set it up.

## Answering the user

Report what changed, in the user's terms — not how you drove the CLI. The
flags, `--json`, the `plan`/`apply` split, exit codes, and the number of
commands you ran are your internal business; the user asked for an outcome, not
a transcript. Say what they got.

- Good: "Added an optional phone number to your user schema and deployed it."
- Avoid: "I ran `plan` and `apply`, both with `--non-interactive --json`, and
  both returned ok."

Quote a command or flag only when the user asks *how* something works, or when
they need to run something themselves. Otherwise keep the mechanics out of the
answer.

## Golden path

The high-level workflow is stable even as individual flags evolve — run each
command's `--help` for its current flags (for example, `setup --help` lists the
framework, sign-in preset, and profile-field options):

```sh
npx @zitadel/cli@alpha doctor --non-interactive --json
npx @zitadel/cli@alpha start --non-interactive --json
npx @zitadel/cli@alpha setup --framework next --server local --force --non-interactive --json
npx @zitadel/cli@alpha doctor --non-interactive --json
npx @zitadel/cli@alpha plan --non-interactive --json
npx @zitadel/cli@alpha apply --non-interactive --json
```

`setup` scaffolds into an empty directory, or patches an existing app project
where it detects a framework. It stops on any other non-empty directory and
asks for `--force` — which the golden path passes because `start` has already
written `.zitadel/local` into the directory. If you run `setup` before `start`,
in a truly empty directory, `--force` is not needed.

The app may also live in a subdirectory of the one `start` ran in: `setup`,
`console` and `--server local` read `.zitadel/local/` from the working
directory or the nearest parent that has it (up to the home directory), so
`mkdir my-app && cd my-app` after `start` works without `--force`. On a local
server that hosts the platform project, `setup` attaches the project to the
local admin's team and ends `data.next_commands` with `console`; when it finds
no local admin for that server on the way up, it says so in the envelope's
`warnings` and the project stays unattached, so the local console does not
list it.

After `setup`, follow `data.next_commands` to start the app. Prove the generated
auth flow in a visible browser by registering a unique user, logging out, logging
back in with the same email/password, and ending on the signed-in profile page.
Do not treat a rendered login or registration form as completion.

To change how users sign in after setup, use the `auth-method` commands. Each
sign-in method has its own command, with `--schema` when the project has more
than one:

- `auth-method password enable` and `auth-method password disable`
- `auth-method passkey enable` and `auth-method passkey disable`
- `auth-method sso enable --provider google` adds a provider. It prompts for
  the client id and secret, or takes `--client-id` with the secret piped on
  stdin when non-interactive. `auth-method sso disable --provider google`
  removes it.

`sso enable` is a deprecated alias of `auth-method sso enable`; use the new
command. The commands change only local files, apart from
`auth-method sso enable`, which also stores the provider's credentials on the
project. When they refuse, they write and publish nothing, on a dry run too.
They refuse to disable a method a login flow still asks for, to change a method
while a login flow has errors that prevent checking it, to enable password on a
schema without `x-identifier`, to edit a value that is not the shape they edit,
and to edit a schema that points at an external URL. Disabling the schema's last
way to sign in needs `--force` when non-interactive; only pass it for a schema
whose users are managed through the API, and ask the user first. That refusal's
`details.suggested_args` lists the `--force` re-run first, then the methods that
could be enabled instead. A dry run of the change is not refused: it previews it
and warns that no way to sign in would be left. A method that is enabled but not
offered by any active flow is reported in `warnings` (and in `data.not_offered`
for password and passkey). Every command reports `data.changed`, the
project-relative files it wrote (on a dry run, the files it would write), empty
when nothing changed. Follow `data.next_commands` (`plan`, `apply`, and
`variables set` when a credential did not reach the project) to publish the
change. When a path or schema name would need shell quoting, `next_commands` is
empty and `data.next_args` (or `details.suggested_args` on a refusal) holds the
same commands as argument lists.

Repo config is authoritative: edit `zitadel.json` or files under `.zitadel/`,
then re-run `plan` and `apply`. See the reference below for driving the login UI
and the config-sync details.

## Reference files

Load on demand:

- [`references/driving-login-ui.md`](references/driving-login-ui.md) — driving the
  `<zitadel-login>` component in a browser, and the authoritative repo-config
  workflow (schemas, flows, branding).
