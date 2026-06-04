---
name: zitadel-cli
description: >-
  Set up and manage Zitadel authentication in a local project with the
  agent-friendly `zitadel` CLI. Use when the user wants to add login,
  registration, or session handling, create a Zitadel project, scaffold auth
  routes for a Next.js App Router app, or plan and apply Zitadel config changes
  from repo state.
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
- See `README.md` (its commands section is generated from the CLI's own
  metadata) or run `zitadel <command> --help` for the full per-command flag list.

```sh
npx @zitadel/cli@latest <command> --non-interactive --json
```

## Reading the envelope

Each invocation prints one JSON object:

- `status`: `ok` | `skipped` | `error`.
- `cli_version`, `command`, `source`: always present.
- On success: `data` with the command-specific payload.
- On a no-op: `reason` (e.g. `no-framework-detected`, `orphaned-config`).
- On failure: `code` (e.g. `E_VALIDATION`, `E_NETWORK`, `E_CONFLICT`) and
  `message`.
- `next_commands`: the suggested follow-ups. Prefer these over free-text hints.

Exit codes mirror the error class (3 = validation, 4 = network, 5 = conflict,
1 = auth, 2 = not-implemented). An unknown command is handled by the CLI's help
layer, not the envelope.

## Commands

- `setup` — create a Zitadel project and scaffold local auth (routes,
  middleware, `.zitadel/**`, env templates). The project's default user schema
  and login flow are provisioned server-side at creation, so setup neither
  scaffolds nor uploads them. Flags: `--framework`, `--renderer`.
- `plan` — validate config and preview the sync diff without mutating anything.
- `apply` — validate and upload repo config to the platform.
- `doctor` — verify generated files and local state; `--fix` re-applies missing
  managed files.
- `status` — summarize the local project state.
- `eject` (alias `uninstall`) — remove managed files and local Zitadel state;
  requires `--force` when non-interactive.

## Golden path

```sh
npx @zitadel/cli@latest setup --framework next --non-interactive --json
npx @zitadel/cli@latest doctor --non-interactive --json
npx @zitadel/cli@latest plan --non-interactive --json
npx @zitadel/cli@latest apply --non-interactive --json
```

Repo config is authoritative: edit `zitadel.json` or files under `.zitadel/`,
then re-run `plan` and `apply`. Managed files carry a marker comment; `eject`
removes only files that still carry it, preserving anything the user replaced.
