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
  terminal. Human mode adapts to the terminal: a TTY gets aligned tables, while a
  piped or redirected run (or `--plain`) gets one tab-separated record per line
  and nothing else. Use `--no-color` to drop ANSI styling from human output.
- **Working directory.** Add `--cwd <path>` when operating outside the current
  working directory.
- **Telemetry.** The CLI sends anonymous usage telemetry by default. For
  automated/agent runs that should stay silent, disable it with `--no-telemetry`
  (per invocation) or `ZITADEL_TELEMETRY=0` / `DO_NOT_TRACK=1` (per environment);
  this also skips the small end-of-command network flush and drops the `ci/` and
  `host/` tokens from the CLI's HTTP `User-Agent`.
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
npx @zitadel/cli@alpha search <query>       # find a command by keyword
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
5 = conflict, 1 = auth, 2 = not-implemented). An unknown command is handled by
the CLI's help layer, not the envelope.

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

After `setup`, follow `data.next_commands` to start the app. Prove the generated
auth flow in a visible browser by registering a unique user, logging out, logging
back in with the same email/password, and ending on the signed-in profile page.
Do not treat a rendered login or registration form as completion.

Repo config is authoritative: edit `zitadel.json` or files under `.zitadel/`,
then re-run `plan` and `apply`. See the reference below for driving the login UI
and the config-sync details.

## Reference files

Load on demand:

- [`references/driving-login-ui.md`](references/driving-login-ui.md) — driving the
  `<zitadel-login>` component in a browser, and the authoritative repo-config
  workflow (schemas, flows, branding).
