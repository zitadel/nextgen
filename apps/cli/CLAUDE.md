# Zitadel CLI Agent Contract

Agents should run `zitadel <command> --non-interactive --json` and read the JSON envelope. The sections below marked generated are produced from the CLI registry at build time; do not edit them by hand.

## Required agent flags

```sh
npx zitadel@latest <command> --non-interactive --json
```

Use `--cwd <path>` when acting outside the current working directory. Discover commands and flags with:

```sh
npx zitadel@latest capabilities --json
npx zitadel@latest help <command> --json
```

## JSON envelope

Every envelope includes `status`, `cli_version`, `command`, and `source` at the top level.

```json
{ "status": "ok", "cli_version": "0.1.0", "command": "setup", "source": "https://api.zitadel.cloud", "data": {}, "warnings": [] }
{ "status": "skipped", "cli_version": "0.1.0", "command": "setup", "source": "mock", "reason": "already-initialized" }
{ "status": "error", "cli_version": "0.1.0", "command": "apply", "source": "mock", "code": "E_VALIDATION", "message": "...", "hint": "...", "next_commands": ["zitadel setup"] }
```

Agents should prefer `next_commands` (machine-actionable) over the free-text `hint`.

## Files

Setup creates:

- `zitadel.json` (project config, includes a `server` field — a URL or the literal `mock`)
- `.zitadel/secret` with POSIX mode `0600`
- `.zitadel/schemas/user.json`
- `.zitadel/flows/login.json`, `.zitadel/flows/register.json`
- `.zitadel/state.json` (framework, package manager, dev port, last apply)
- `.env.example`, `.env.local`
- Next App Router files under `app/` or `src/app/`

`.zitadel/secret` and local env files must stay gitignored.

## Claim boundary

Agents do not claim projects. Stop at `zitadel claim` and hand the claim URL to a human.

<!-- generated:capabilities:begin -->

Envelope schema version: `1`. Every envelope carries `cli_version`, `command`, `source` at the top level.

## Commands

| Command | Summary | Agent status |
|---|---|---|
| `zitadel setup` | Create a pre-claim project and scaffold local auth. | supported-mock-default |
| `zitadel plan` | Validate config and deploy readiness without mutation. | supported |
| `zitadel apply` | Validate and upload repo config to the platform. | supported-mock-default |
| `zitadel doctor` | Verify generated files and local state. | supported |
| `zitadel deploy status` | Report deploy platform readiness. | supported |
| `zitadel deploy connect` | Configure preview or production platform env vars. | supported |
| `zitadel claim` | Begin the human handoff to claim the project. | handoff |
| `zitadel add schema` | Add or remove fields on the user schema. | supported |
| `zitadel capabilities` | Describe the CLI contract (commands, flags, exit codes). Agent introspection target. | supported |
| `zitadel help` | Show help for the CLI or a specific command. | supported |
| `zitadel status` | Summarize the local project state. | supported |
| `zitadel eject` | Remove managed files and local Zitadel state. | supported |

### `zitadel setup`

Create a pre-claim project and scaffold local auth.

Usage: `zitadel setup [--framework next] [--user-fields ...] [--auth-methods ...]`

| Flag | Type | Description |
|---|---|---|
| `--cwd` / `-c` | `string` | Project directory to operate on. |
| `--json` / `-j` | `boolean` | Emit the JSON envelope instead of pretty output. |
| `--non-interactive` / `-n` | `boolean` | Disable prompts. Required when scripting or running as an agent. |
| `--dry-run` | `boolean` | Preview the work without mutating files or hitting the platform. |
| `--force` / `-f` | `boolean` | Overwrite protected files when conflicts are detected. |
| `--server` / `-s` | `string` | Override the resolved server URL (or "mock"). |
| `--mock` | `boolean` | Alias for --server mock. |
| `--framework` | `string` | Framework to target (v1 supports "next"). |
| `--user-fields` | `string` | Comma-separated list of user fields. |
| `--auth-methods` | `string` | Comma-separated list of auth methods. |
| `--skip-deploy-platform` | `boolean` | Skip deploy platform detection and connect. |
| `--platform` | `string` | Deploy platform override (vercel/netlify/cloudflare/none). |
| `--manual` | `boolean` | Emit manual deploy steps instead of configuring the provider. |
| `--no-apply` | `boolean` | Skip the automatic apply at the end of setup. |

### `zitadel plan`

Validate config and deploy readiness without mutation.

Usage: `zitadel plan [--environment development|preview|production]`

| Flag | Type | Description |
|---|---|---|
| `--cwd` / `-c` | `string` | Project directory to operate on. |
| `--json` / `-j` | `boolean` | Emit the JSON envelope instead of pretty output. |
| `--non-interactive` / `-n` | `boolean` | Disable prompts. Required when scripting or running as an agent. |
| `--dry-run` | `boolean` | Preview the work without mutating files or hitting the platform. |
| `--force` / `-f` | `boolean` | Overwrite protected files when conflicts are detected. |
| `--server` / `-s` | `string` | Override the resolved server URL (or "mock"). |
| `--mock` | `boolean` | Alias for --server mock. |
| `--environment` / `-e` | `string` | Target environment (default: development). |
| `--platform` | `string` | Deploy platform override. |

### `zitadel apply`

Validate and upload repo config to the platform.

Usage: `zitadel apply [--environment development|preview|production]`

| Flag | Type | Description |
|---|---|---|
| `--cwd` / `-c` | `string` | Project directory to operate on. |
| `--json` / `-j` | `boolean` | Emit the JSON envelope instead of pretty output. |
| `--non-interactive` / `-n` | `boolean` | Disable prompts. Required when scripting or running as an agent. |
| `--dry-run` | `boolean` | Preview the work without mutating files or hitting the platform. |
| `--force` / `-f` | `boolean` | Overwrite protected files when conflicts are detected. |
| `--server` / `-s` | `string` | Override the resolved server URL (or "mock"). |
| `--mock` | `boolean` | Alias for --server mock. |
| `--environment` / `-e` | `string` | Target environment (default: development). |
| `--platform` | `string` | Deploy platform override. |

### `zitadel doctor`

Verify generated files and local state.

Usage: `zitadel doctor [--fix]`

| Flag | Type | Description |
|---|---|---|
| `--cwd` / `-c` | `string` | Project directory to operate on. |
| `--json` / `-j` | `boolean` | Emit the JSON envelope instead of pretty output. |
| `--non-interactive` / `-n` | `boolean` | Disable prompts. Required when scripting or running as an agent. |
| `--dry-run` | `boolean` | Preview the work without mutating files or hitting the platform. |
| `--force` / `-f` | `boolean` | Overwrite protected files when conflicts are detected. |
| `--server` / `-s` | `string` | Override the resolved server URL (or "mock"). |
| `--mock` | `boolean` | Alias for --server mock. |
| `--fix` | `boolean` | Re-apply missing managed files. |

### `zitadel deploy status`

Report deploy platform readiness.

Usage: `zitadel deploy status [--platform vercel|netlify|cloudflare]`

| Flag | Type | Description |
|---|---|---|
| `--cwd` / `-c` | `string` | Project directory to operate on. |
| `--json` / `-j` | `boolean` | Emit the JSON envelope instead of pretty output. |
| `--non-interactive` / `-n` | `boolean` | Disable prompts. Required when scripting or running as an agent. |
| `--dry-run` | `boolean` | Preview the work without mutating files or hitting the platform. |
| `--force` / `-f` | `boolean` | Overwrite protected files when conflicts are detected. |
| `--server` / `-s` | `string` | Override the resolved server URL (or "mock"). |
| `--mock` | `boolean` | Alias for --server mock. |
| `--platform` | `string` | Force a deploy platform adapter. |
| `--environment` / `-e` | `string` | Target environment (default: preview). |

### `zitadel deploy connect`

Configure preview or production platform env vars.

Usage: `zitadel deploy connect [--environment preview|production]`

| Flag | Type | Description |
|---|---|---|
| `--cwd` / `-c` | `string` | Project directory to operate on. |
| `--json` / `-j` | `boolean` | Emit the JSON envelope instead of pretty output. |
| `--non-interactive` / `-n` | `boolean` | Disable prompts. Required when scripting or running as an agent. |
| `--dry-run` | `boolean` | Preview the work without mutating files or hitting the platform. |
| `--force` / `-f` | `boolean` | Overwrite protected files when conflicts are detected. |
| `--server` / `-s` | `string` | Override the resolved server URL (or "mock"). |
| `--mock` | `boolean` | Alias for --server mock. |
| `--platform` | `string` | Force a deploy platform adapter. |
| `--environment` / `-e` | `string` | Target environment (default: preview). |
| `--manual` | `boolean` | Emit manual steps instead of configuring. |

### `zitadel claim`

Begin the human handoff to claim the project.

> Agents must stop here and hand the claim URL to a human.

Usage: `zitadel claim`

| Flag | Type | Description |
|---|---|---|
| `--cwd` / `-c` | `string` | Project directory to operate on. |
| `--json` / `-j` | `boolean` | Emit the JSON envelope instead of pretty output. |
| `--non-interactive` / `-n` | `boolean` | Disable prompts. Required when scripting or running as an agent. |
| `--dry-run` | `boolean` | Preview the work without mutating files or hitting the platform. |
| `--force` / `-f` | `boolean` | Overwrite protected files when conflicts are detected. |
| `--server` / `-s` | `string` | Override the resolved server URL (or "mock"). |
| `--mock` | `boolean` | Alias for --server mock. |

### `zitadel add schema`

Add or remove fields on the user schema.

Usage: `zitadel add schema [--add-field-json '{...}' | --add-field name:type:attrs] [--remove-field name]`

| Flag | Type | Description |
|---|---|---|
| `--cwd` / `-c` | `string` | Project directory to operate on. |
| `--json` / `-j` | `boolean` | Emit the JSON envelope instead of pretty output. |
| `--non-interactive` / `-n` | `boolean` | Disable prompts. Required when scripting or running as an agent. |
| `--dry-run` | `boolean` | Preview the work without mutating files or hitting the platform. |
| `--force` / `-f` | `boolean` | Overwrite protected files when conflicts are detected. |
| `--server` / `-s` | `string` | Override the resolved server URL (or "mock"). |
| `--mock` | `boolean` | Alias for --server mock. |
| `--add-field` | `string[]` | Add a field using the colon-DSL (name:type:key=value,...). |
| `--add-field-json` | `string[]` | Add a field using a JSON object. Preferred for agents. |
| `--remove-field` | `string[]` | Remove a field by name. |

### `zitadel capabilities`

Describe the CLI contract (commands, flags, exit codes). Agent introspection target.

Usage: `zitadel capabilities [--json]`

| Flag | Type | Description |
|---|---|---|
| `--cwd` / `-c` | `string` | Project directory to operate on. |
| `--json` / `-j` | `boolean` | Emit the JSON envelope instead of pretty output. |
| `--non-interactive` / `-n` | `boolean` | Disable prompts. Required when scripting or running as an agent. |
| `--dry-run` | `boolean` | Preview the work without mutating files or hitting the platform. |
| `--force` / `-f` | `boolean` | Overwrite protected files when conflicts are detected. |
| `--server` / `-s` | `string` | Override the resolved server URL (or "mock"). |
| `--mock` | `boolean` | Alias for --server mock. |

### `zitadel help`

Show help for the CLI or a specific command.

Usage: `zitadel help [command]`

| Flag | Type | Description |
|---|---|---|
| `--cwd` / `-c` | `string` | Project directory to operate on. |
| `--json` / `-j` | `boolean` | Emit the JSON envelope instead of pretty output. |
| `--non-interactive` / `-n` | `boolean` | Disable prompts. Required when scripting or running as an agent. |
| `--dry-run` | `boolean` | Preview the work without mutating files or hitting the platform. |
| `--force` / `-f` | `boolean` | Overwrite protected files when conflicts are detected. |
| `--server` / `-s` | `string` | Override the resolved server URL (or "mock"). |
| `--mock` | `boolean` | Alias for --server mock. |

### `zitadel status`

Summarize the local project state.

Usage: `zitadel status`

| Flag | Type | Description |
|---|---|---|
| `--cwd` / `-c` | `string` | Project directory to operate on. |
| `--json` / `-j` | `boolean` | Emit the JSON envelope instead of pretty output. |
| `--non-interactive` / `-n` | `boolean` | Disable prompts. Required when scripting or running as an agent. |
| `--dry-run` | `boolean` | Preview the work without mutating files or hitting the platform. |
| `--force` / `-f` | `boolean` | Overwrite protected files when conflicts are detected. |
| `--server` / `-s` | `string` | Override the resolved server URL (or "mock"). |
| `--mock` | `boolean` | Alias for --server mock. |

### `zitadel eject`

Remove managed files and local Zitadel state.

> Does not delete the remote project. Back up .env.local before removing.

Usage: `zitadel eject [--force]`

| Flag | Type | Description |
|---|---|---|
| `--cwd` / `-c` | `string` | Project directory to operate on. |
| `--json` / `-j` | `boolean` | Emit the JSON envelope instead of pretty output. |
| `--non-interactive` / `-n` | `boolean` | Disable prompts. Required when scripting or running as an agent. |
| `--dry-run` | `boolean` | Preview the work without mutating files or hitting the platform. |
| `--force` / `-f` | `boolean` | Overwrite protected files when conflicts are detected. |
| `--server` / `-s` | `string` | Override the resolved server URL (or "mock"). |
| `--mock` | `boolean` | Alias for --server mock. |

## Exit codes

| Code | Error code(s) |
|---:|---|
| 0 | `E_ALREADY_INIT` |
| 1 | `E_AUTH` |
| 2 | `E_NOT_IMPLEMENTED` |
| 3 | `E_FRAMEWORK_NOT_DETECTED`, `E_UNSUPPORTED_PROJECT_SHAPE`, `E_VALIDATION`, `E_CLAIM_REQUIRED` |
| 4 | `E_NETWORK` |
| 5 | `E_CONFLICT` |
| 6 | `E_PLATFORM_HANDOFF` |

## Server resolution

Precedence (highest wins):

1. `--server <url|mock>` flag
2. `ZITADEL_API_BASE` env var
3. `zitadel.json#environments.<env>.server`
4. `zitadel.json#server`
5. Default: `https://api.zitadel.cloud`

The envelope `source` reports the resolved value (a URL or the literal `mock`).

<!-- generated:capabilities:end -->
