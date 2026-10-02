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

## Invocation rules

- Always pass `--non-interactive --json`. The envelope is the contract.
- Add `--cwd <path>` when operating outside the current working directory.
- Never run interactive prompts; `--non-interactive` (and `--json`) disable them.
- The CLI sends anonymous usage telemetry by default. For automated/agent runs
  that should stay silent, disable it with `--no-telemetry` (per invocation) or
  `ZITADEL_TELEMETRY=0` / `DO_NOT_TRACK=1` (per environment); this also skips the
  small end-of-command network flush and drops the `ci/` and `host/` tokens from
  the CLI's HTTP `User-Agent`.
- See [`references/commands.md`](references/commands.md) for the per-command
  detail, or run `zitadel <command> --help` for the authoritative per-command
  flag list.
- Flags follow the conventions a model already expects from curl, ssh and wget:
  `--help`/`-h`, `--version`, `-v`/`--verbose`, kebab-case long flags, both
  `--flag value` and `--flag=value`, and `--no-telemetry`-style negation. `-v`
  is the short form of `--verbose` on every product command (the built-in oclif
  utilities such as `version` and `which` have their own smaller flag surface —
  the per-command `--help` above is authoritative). Two deliberate deviations
  worth knowing: `-n` is `--non-interactive`
  (not `--dry-run`, which is long-only), and machine output is `--json` (not
  `--output json`). These are the agent-critical flags, so they keep the
  spellings agents reach for most.

```sh
npx @zitadel/cli@alpha <command> --non-interactive --json
```

During the public alpha, bare `npx @zitadel/cli` is promoted to the same tested
alpha CLI so discovery works for first-time users. Prefer `@alpha` or an exact
`0.1.0-alpha.N` selector in agent scripts and bug reports for reproducibility.

## Reading the envelope

Each invocation prints one JSON object:

- `status`: `ok` | `skipped` | `error`.
- `cli_version`, `command`, `source`: always present.
- On success: `data` with the command-specific payload.
- On a no-op: `reason` (e.g. `no-framework-detected`, `orphaned-config`).
- On failure: `code` (e.g. `E_VALIDATION`, `E_NETWORK`, `E_NOT_FOUND`,
  `E_CONFLICT`) and `message`.
- `next_commands`: the suggested follow-ups. Prefer these over free-text hints.
- `plan` and `apply` also emit `data.changes`: one row per touched resource
  (`{kind, action, file, id?, previous_id?}`, action ∈ create/update/revision/
  delete). Plan rows preview; apply rows report, with the resulting platform
  ids. Use it to verify an edit did what you intended — `apply`'s
  `files_updated` lists only local write-backs, not platform changes.
- `setup` emits `data.files`: one typed row per scaffolded artifact
  (`{path, kind: file|dir, action: create|update}`), deduplicated. Use it to
  see what setup created versus merged into (your `package.json` is an
  `update`). `data.files_written` remains the flat list — deduplicated file
  paths only, covering both scaffolded and `.zitadel/` resource files.
- `setup` never writes `.zitadel/branding/` or publishes a branding
  revision: the login renders the maintained `<zitadel-login>` component.
  Taking ownership of the widget template is the separate, opt-in
  `branding eject` command.
- `E_LOCAL_SERVER_NOT_RUNNING`: start the local runtime with
  `npx @zitadel/cli@alpha start`, then retry with `--server local`.
- `E_NOT_FOUND`: an HTTP 404 from the target server. With the platform's
  error envelope it names a missing resource (e.g. an unknown schema id);
  without one the endpoint itself is missing — the `--server` value likely
  points at something that is not a Zitadel platform API. Follow
  `next_commands` (usually `start` + retry with `--server local`).
- `E_PORT_IN_USE`: the requested local runtime port already has a listener.
  Stop that process, run `npx @zitadel/cli@alpha stop --all` for host-wide
  CLI-managed local runtimes, or choose another `start --port`.

In human mode the output follows the terminal: a TTY gets the project and
server lines and an aligned table, while a piped or redirected run (or
`--plain`) gets one tab-separated record per line and nothing else. `--json`
is unaffected and remains the contract for agents.

Text the server returns is escaped before it is printed, in `--json` as in
human mode, so a value someone stored cannot drive the reader's terminal.
Control, format and bidi characters in `data` values and keys and in an
error's `message` appear as visible `\xNN`, `\uNNNN` or `\u{NNNNN}` text;
newlines and tabs are kept, and a key's backslashes are doubled so two keys
never merge. A value that contained such a character is therefore not the
stored value byte for byte: do not send it back in an update as if it were.
When you need the exact stored value, call the platform API directly with the
project secret; the CLI only ever shows the escaped form.
`plan`, `apply` and `setup` are the exception for `.zitadel/` files: they
write the server's bodies back verbatim and escape only what they print.

A property whose name reads as a credential (`password`, `client_secret`,
`api_key`, …) is refused anywhere on the command line — as an `--attributes`
entry and inside an inline `--data` body alike, since argv is visible to other
processes and kept in shell history. Send such bodies with `--file <path>` or
`--file -` (stdin), which never pass through argv.

Capture stdout and stderr separately when scripting. Some terminals and agent
UIs display both streams together, but the machine contract is one parseable
JSON object on stdout; installer, audit, and package-manager progress belongs
on stderr.

Exit codes mirror the error class (3 = validation, 4 = network or not-found,
5 = conflict, 1 = auth, 2 = not-implemented). An unknown command is handled by
the CLI's help layer, not the envelope.

## Golden path

```sh
npx @zitadel/cli@alpha doctor --non-interactive --json
npx @zitadel/cli@alpha start --non-interactive --json
npx @zitadel/cli@alpha setup --framework next --server local --non-interactive --json
npx @zitadel/cli@alpha doctor --non-interactive --json
npx @zitadel/cli@alpha plan --non-interactive --json
npx @zitadel/cli@alpha apply --non-interactive --json
```

Exact alpha train invocation:

```sh
npx @zitadel/cli@0.1.0-alpha.N doctor --non-interactive --json
npx @zitadel/cli@0.1.0-alpha.N start --non-interactive --json
npx @zitadel/cli@0.1.0-alpha.N setup --framework next --server local --non-interactive --json
```

After `setup`, follow `data.next_commands` to start the app. Prove the generated
auth flow in a visible browser by registering a unique user, logging out, logging
back in with the same email/password, and ending on the signed-in profile page.
Do not treat a rendered login or registration form as completion.


## Reference files

Load on demand:

- [`references/resource-commands.md`](references/resource-commands.md) — the uniform `zitadel <resource> <verb>` surface (users, teams, sessions, events, grants, projects).
- [`references/commands.md`](references/commands.md) — per-command detail for the project, local-server, and configuration groups (`setup`, `claim`, `doctor`, `start`, `stop`, `plan`, `apply`, `sso`, `branding`, `variables`, …).
- [`references/driving-login-ui.md`](references/driving-login-ui.md) — driving the `<zitadel-login>` component and the authoritative repo-config workflow.
