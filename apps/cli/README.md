# @zitadel/cli

Scaffolds Zitadel auth (login, register, profile, middleware/proxy) into a Next.js, Nuxt, React, Vue, Angular, Solid, Svelte, or Qwik app.

```sh
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --server local
```

During the public alpha, bare `npx @zitadel/cli` resolves to the same tested
alpha CLI. Use `@alpha` or an exact `0.1.0-alpha.N` selector in bug reports and
automation when reproducibility matters.

> **Beta.** This is the **next-generation Zitadel**, a ground-up rewrite of the platform. It is distinct from the established Zitadel at [github.com/zitadel/zitadel](https://github.com/zitadel/zitadel). APIs and CLI flags will change.

## Requirements

- Node from the supported range in `package.json#engines` (currently ≥ 24)
- Docker only when using the optional Docker runtime backend
- An app in one of the eight supported frameworks, or an empty directory
  where setup can scaffold one

## Quickstart

```sh
mkdir my-app
cd my-app
npx @zitadel/cli@alpha doctor
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --server local
npm run dev
```

`start` runs the `@zitadel/server` npm binary by default and stores runtime data
under `.zitadel/local/` (SQLite by default). Remote-server setup can use
`--server <url>` without starting a local runtime. Use `--runtime docker`,
`--image`, or `ZITADEL_LOCAL_IMAGE` for advanced Docker backend debugging.
`setup --server local` creates a project on that local server, asks which
framework to scaffold when the directory is fresh (and which login design to
use), writes the app into the current directory, and scaffolds the framework's
idiomatic auth routes plus the proxy layer — for Next.js that means
`app/login`, `app/register`, `app/profile`, and `proxy.ts` for Next 16+ or
`middleware.ts` for older versions; other frameworks get their equivalents
from the same patcher system. In a pre-existing app, setup derives the
embedding posture from the app instead of assuming a fresh skeleton: the
scaffolded pages take the `variant="widget"` posture inside your app's own
shell, recorded in the scaffold manifest and verified by `doctor`. Fresh
scaffolds also replace the starter home page with a redirect to `/login`.
Setup writes `.env.local` and `.zitadel/`, and installs
dependencies with the detected package manager. Pass `--skip-install` to install
them yourself. The project's default user schema and login flow are provisioned
from versioned local defaults; setup writes editable copies into
`.zitadel/schemas/default-human-user.json` and
`.zitadel/flows/default-login.json`, uploads them through the schema and flow
APIs, then seeds `.zitadel/state.json` so `zitadel plan` is immediately empty.
Open the dev server URL printed by your framework, register a user, log out,
log back in, and end on the signed-in profile page.

For a reproducible tester report, use the exact alpha train from the GitHub
Release:

```sh
npx @zitadel/cli@0.1.0-alpha.N doctor
npx @zitadel/cli@0.1.0-alpha.N start
npx @zitadel/cli@0.1.0-alpha.N setup --server local
```

The default project flow supports password registration/login, passkey
registration/login, and optional passkey setup after password registration.
Users who skip passkey setup can still sign in with password; users who add a
passkey can sign in with either credential.

Repo config is authoritative: edit `zitadel.json`, `.zitadel/schemas/*.json`,
`.zitadel/flows/*.json`, or `.zitadel/branding/` (a `branding.json` descriptor
plus a `login.liquid` LiquidJS template), then re-run `zitadel plan` and
`zitadel apply`. Server-provisioned defaults remain a fallback for non-CLI
project creation, but CLI-created projects are authored from local files first.
Login templates are supported: scaffold them with the `branding eject` command
(`--design centered|split|split-right|hero|minimal`) or `setup --design <name>`;
every edit publishes a new immutable branding revision and the login serves
the newest one. Flow create, read, list, update, and delete are available; the
server enforces flow lifecycle rules such as draft-only edits.

For agent scripts, pass `--non-interactive --json` and capture stdout and stderr
separately. The CLI contract is one parseable JSON object on stdout; terminals
and agent UIs may display stderr package-manager progress together with stdout.

## Other commands

- `zitadel claim` — claim the project to make it permanent (opens the claim
  page, polls for completion; the claim then shows in `setup`, `status`, and
  `doctor`)
- `zitadel doctor` — verify the local runtime and generated project files
  (including scaffold drift and dependency-version alignment)
- `zitadel status` — summarise the local runtime and project
- `zitadel plan` — validate config and preview sync changes without mutation
- `zitadel apply` — validate and upload repo config to Zitadel
- `zitadel branding eject` — scaffold an editable login template from a design
- `zitadel schemas list` — list the project's user schemas
- `zitadel eject` — remove what setup wrote (alias: `zitadel uninstall`)
- `zitadel start|stop|logs|reset` — manage the local runtime

The full agent-facing contract (JSON envelope, posture rules, claim flow,
doctor repair) is [`SKILLS.md`](https://github.com/zitadel/nextgen/blob/main/apps/cli/SKILLS.md),
which ships in this package.

## Reference

<details>
<summary>Full command reference</summary>

<!-- commands -->
* [`zitadel apply`](#zitadel-apply)
* [`zitadel autocomplete [SHELL]`](#zitadel-autocomplete-shell)
* [`zitadel branding eject`](#zitadel-branding-eject)
* [`zitadel claim`](#zitadel-claim)
* [`zitadel commands`](#zitadel-commands)
* [`zitadel doctor`](#zitadel-doctor)
* [`zitadel eject`](#zitadel-eject)
* [`zitadel events get ID`](#zitadel-events-get-id)
* [`zitadel events list`](#zitadel-events-list)
* [`zitadel grants create`](#zitadel-grants-create)
* [`zitadel grants delete ID`](#zitadel-grants-delete-id)
* [`zitadel grants get ID`](#zitadel-grants-get-id)
* [`zitadel grants list`](#zitadel-grants-list)
* [`zitadel help [COMMAND]`](#zitadel-help-command)
* [`zitadel logs`](#zitadel-logs)
* [`zitadel plan`](#zitadel-plan)
* [`zitadel projects get ID`](#zitadel-projects-get-id)
* [`zitadel projects list`](#zitadel-projects-list)
* [`zitadel projects update ID`](#zitadel-projects-update-id)
* [`zitadel reset`](#zitadel-reset)
* [`zitadel resources`](#zitadel-resources)
* [`zitadel schemas list`](#zitadel-schemas-list)
* [`zitadel search`](#zitadel-search)
* [`zitadel sessions get ID`](#zitadel-sessions-get-id)
* [`zitadel sessions list`](#zitadel-sessions-list)
* [`zitadel sessions revoke ID`](#zitadel-sessions-revoke-id)
* [`zitadel setup`](#zitadel-setup)
* [`zitadel start`](#zitadel-start)
* [`zitadel status`](#zitadel-status)
* [`zitadel stop`](#zitadel-stop)
* [`zitadel teams create`](#zitadel-teams-create)
* [`zitadel teams delete ID`](#zitadel-teams-delete-id)
* [`zitadel teams get ID`](#zitadel-teams-get-id)
* [`zitadel teams list`](#zitadel-teams-list)
* [`zitadel teams update ID`](#zitadel-teams-update-id)
* [`zitadel uninstall`](#zitadel-uninstall)
* [`zitadel users create`](#zitadel-users-create)
* [`zitadel users delete ID`](#zitadel-users-delete-id)
* [`zitadel users get ID`](#zitadel-users-get-id)
* [`zitadel users list`](#zitadel-users-list)
* [`zitadel users update ID`](#zitadel-users-update-id)
* [`zitadel version`](#zitadel-version)
* [`zitadel which`](#zitadel-which)

## `zitadel apply`

Validate and upload repo config to the platform.

```
USAGE
  $ zitadel apply [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [-e
    development|preview|production]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Validate and upload repo config to the platform.
```

## `zitadel autocomplete [SHELL]`

Display autocomplete installation instructions.

```
USAGE
  $ zitadel autocomplete [SHELL] [-r]

ARGUMENTS
  [SHELL]  (zsh|bash|powershell) Shell type

FLAGS
  -r, --refresh-cache  Refresh cache (ignores displaying instructions)

DESCRIPTION
  Display autocomplete installation instructions.

EXAMPLES
  $ zitadel autocomplete

  $ zitadel autocomplete bash

  $ zitadel autocomplete zsh

  $ zitadel autocomplete powershell

  $ zitadel autocomplete --refresh-cache
```

_See code: [@oclif/plugin-autocomplete](https://github.com/oclif/plugin-autocomplete/blob/v3.2.50/src/commands/autocomplete/index.ts)_

## `zitadel branding eject`

Take ownership of the login template: scaffold .zitadel/branding/ from a shipped design.

```
USAGE
  $ zitadel branding eject [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [-f] [--design
    centered|split|split-right|hero|minimal]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite an existing branding file.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --design=<option>  Design to start from (default: centered).
                         <options: centered|split|split-right|hero|minimal>
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Take ownership of the login template: scaffold .zitadel/branding/ from a
  shipped design.
```

## `zitadel claim`

Claim this project to make it permanent. Opens a browser to create an account or sign in.

```
USAGE
  $ zitadel claim [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--no-open] [--timeout
    <value>]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --no-open          Print the link instead of opening a browser.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.
      --timeout=<value>  Seconds to wait for the browser step. Defaults to the
                         link's own expiry (10 minutes).
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Claim this project to make it permanent. Opens a browser to create an account
  or sign in.

EXAMPLES
  $ zitadel claim

  $ zitadel claim --no-open

  $ zitadel claim --timeout 120
```

## `zitadel commands`

List all zitadel commands.

```
USAGE
  $ zitadel commands [--json] [-c id|plugin|summary|type... | --tree]
    [--deprecated] [-x | ] [--hidden] [--no-truncate | ] [--sort
    id|plugin|summary|type | ]

FLAGS
  -c, --columns=<option>...  Only show provided columns (comma-separated).
                             <options: id|plugin|summary|type>
  -x, --extended             Show extra columns.
      --deprecated           Show deprecated commands.
      --hidden               Show hidden commands.
      --no-truncate          Do not truncate output.
      --sort=<option>        [default: id] Property to sort by.
                             <options: id|plugin|summary|type>
      --tree                 Show tree of commands.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List all zitadel commands.
```

_See code: [@oclif/plugin-commands](https://github.com/oclif/plugin-commands/blob/4.1.55/src/commands/commands.ts)_

## `zitadel doctor`

Verify local runtime and project state.

```
USAGE
  $ zitadel doctor [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--fix] [--image <value>]
    [--port <value>] [--runtime binary|docker]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --fix               Repair missing files and stale managed wiring.
      --image=<value>     Container image to check.
      --port=<value>      [default: 8080] Local HTTP port.
      --runtime=<option>  Local runtime backend.
                          <options: binary|docker>
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Verify local runtime and project state.
```

## `zitadel eject`

Remove managed files and local Zitadel state.

```
USAGE
  $ zitadel eject [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [-f]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Remove the managed files without the confirmation
                         prompt.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove managed files and local Zitadel state.

ALIASES
  $ zitadel uninstall
```

## `zitadel events get ID`

Get one event by id.

```
USAGE
  $ zitadel events get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--fields <value>] [-e
    development|preview|production]

ARGUMENTS
  ID  event id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --fields=<value>        Fields to show, comma-separated dot-paths.
                              Defaults to the resource's own; `--json` is
                              unaffected.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one event by id.

EXAMPLES
  $ zitadel events get <id>

  $ zitadel events get <id> --json
```

## `zitadel events list`

List events.

```
USAGE
  $ zitadel events list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--limit <value>] [-a |
    --page-token <value>] [--fields <value>] [--plain] [--category
    request|auth|session|admin|entity|signal...] [--event-type <value>...]
    [--actor-id <value>] [--session-id <value>] [--flow-id <value>]
    [--request-id <value>] [--entity-type <value>] [--entity-id <value>]
    [--team-id <value>] [--created-after <value>] [--created-before <value>]
    [--order asc|desc] [-e development|preview|production]

FLAGS
  -a, --all                     Fetch every page instead of one.
  -c, --cwd=<value>             Project directory to operate on.
  -e, --environment=<option>    Target environment (default: development).
                                <options: development|preview|production>
  -n, --non-interactive         Disable prompts. Required when scripting or
                                running as an agent.
  -s, --server=<value>          Override the resolved server URL.
      --actor-id=<value>        Filter by the acting principal.
      --category=<option>...    Wide-event category (repeatable, OR within the
                                flag).
                                <options:
                                request|auth|session|admin|entity|signal>
      --created-after=<value>   Inclusive lower bound on created_at (RFC 3339).
      --created-before=<value>  Exclusive upper bound on created_at (RFC 3339).
      --debug                   Debug logging.
      --dry-run                 Preview without mutating files or the platform.
      --entity-id=<value>       Filter by entity id.
      --entity-type=<value>     Filter by entity type.
      --event-type=<value>...   Exact event_type match (repeatable, OR within
                                the flag).
      --fields=<value>          Columns to show, comma-separated dot-paths (e.g.
                                id,attributes.email). Defaults to the resource's
                                own columns; `--json` is unaffected.
      --flow-id=<value>         Filter by login flow id.
      --limit=<value>           Page size (server default 20, max 100).
      --order=<option>          Sort direction on created_at (default: desc).
                                <options: asc|desc>
      --page-token=<value>      Continue from a previous page's next_page_token.
      --plain                   Tab-separated rows with no header, for piping.
                                Implied when stdout is not a terminal.
      --request-id=<value>      Filter by request id.
      --session-id=<value>      Filter by session id.
      --team-id=<value>         Filter by emit-time team scope.
      --[no-]telemetry          Send anonymous usage analytics. Disable with
                                --no-telemetry.
      --verbose                 Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List events.

EXAMPLES
  $ zitadel events list --json

  $ zitadel events list --all --json

  $ zitadel events list --category request --limit 50
```

## `zitadel grants create`

Create a grant.

```
USAGE
  $ zitadel grants create [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--principal-type user|team]
    [--principal-id <value>] [--relation viewer|editor|admin] [--expires-at
    <value>] [--data <value> | --file <value>] [-e
    development|preview|production]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

RAW BODY FLAGS
  --data=<value>  Whole body as a JSON object, instead of the field flags.
  --file=<value>  Read the body from a JSON file; `-` reads stdin.

OPTIONAL FIELD FLAGS
  --expires-at=<value>  Optional expiry.

GLOBAL FLAGS
  --json  Format output as json.

REQUIRED FIELD FLAGS
  --principal-id=<value>     (required) Principal id (`user_<opaque>` or
                             `team_<opaque>`).
  --principal-type=<option>  (required) Kind of principal to bind.
                             <options: user|team>
  --relation=<option>        (required) Catalog relation on `object_type`
                             `project`.
                             <options: viewer|editor|admin>

DESCRIPTION
  Create a grant.

EXAMPLES
  $ zitadel grants create --principal-type user --principal-id <principal_id> --relation viewer --json

  $ zitadel grants create --data '{...}' --json

  $ zitadel grants create --file ./grant.json
```

## `zitadel grants delete ID`

Delete a grant by id.

```
USAGE
  $ zitadel grants delete ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [-f] [-e
    development|preview|production]

ARGUMENTS
  ID  grant id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -f, --force                 Delete the grant without the confirmation prompt.
                              Required when non-interactive.
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Delete a grant by id.

EXAMPLES
  $ zitadel grants delete <id> --force --json
```

## `zitadel grants get ID`

Get one grant by id.

```
USAGE
  $ zitadel grants get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--fields <value>] [-e
    development|preview|production]

ARGUMENTS
  ID  grant id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --fields=<value>        Fields to show, comma-separated dot-paths.
                              Defaults to the resource's own; `--json` is
                              unaffected.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one grant by id.

EXAMPLES
  $ zitadel grants get <id>

  $ zitadel grants get <id> --json
```

## `zitadel grants list`

List grants.

```
USAGE
  $ zitadel grants list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--limit <value>] [-a |
    --page-token <value>] [--fields <value>] [--plain] [--filter <value>...]
    [--sort <value>] [-e development|preview|production]

FLAGS
  -a, --all
      Fetch every page instead of one.

  -c, --cwd=<value>
      Project directory to operate on.

  -e, --environment=<option>
      Target environment (default: development).
      <options: development|preview|production>

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  --debug
      Debug logging.

  --dry-run
      Preview without mutating files or the platform.

  --fields=<value>
      Columns to show, comma-separated dot-paths (e.g. id,attributes.email).
      Defaults to the resource's own columns; `--json` is unaffected.

  --filter=<value>...
      Filter as field=operation:value (operation defaults to equals). Fields:
      created_at, principal_type, principal_id, relation, expires_at. Operations:
      equals, not_equals, contains, not_contains, less_than, less_than_or_equal,
      greater_than, greater_than_or_equal.

  --limit=<value>
      Page size (server default 20, max 100).

  --page-token=<value>
      Continue from a previous page's next_page_token.

  --plain
      Tab-separated rows with no header, for piping. Implied when stdout is not a
      terminal.

  --sort=<value>
      Sort as field:direction (asc|desc). Fields: created_at, expires_at, id.

  --[no-]telemetry
      Send anonymous usage analytics. Disable with --no-telemetry.

  --verbose
      Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List grants.

EXAMPLES
  $ zitadel grants list --json

  $ zitadel grants list --all --json

  $ zitadel grants list --filter created_at=equals:<value> --sort created_at:desc
```

## `zitadel help [COMMAND]`

Display help for zitadel.

```
USAGE
  $ zitadel help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for zitadel.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/6.2.49/src/commands/help.ts)_

## `zitadel logs`

Show local Zitadel server logs.

```
USAGE
  $ zitadel logs [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--follow] [--tail <value>]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --follow           Follow logs.
      --tail=<value>     [default: 200] Number of lines to show.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Show local Zitadel server logs.
```

## `zitadel plan`

Validate config without mutation and preview the sync diff.

```
USAGE
  $ zitadel plan [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [-e
    development|preview|production]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Validate config without mutation and preview the sync diff.
```

## `zitadel projects get ID`

Get one project by id.

```
USAGE
  $ zitadel projects get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--fields <value>] [-e
    development|preview|production]

ARGUMENTS
  ID  project id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --fields=<value>        Fields to show, comma-separated dot-paths.
                              Defaults to the resource's own; `--json` is
                              unaffected.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one project by id.

EXAMPLES
  $ zitadel projects get <id>

  $ zitadel projects get <id> --json
```

## `zitadel projects list`

List projects.

```
USAGE
  $ zitadel projects list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--limit <value>] [-a |
    --page-token <value>] [--fields <value>] [--plain] [--filter <value>...]
    [--sort <value>] [-e development|preview|production]

FLAGS
  -a, --all                   Fetch every page instead of one.
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --fields=<value>        Columns to show, comma-separated dot-paths (e.g.
                              id,attributes.email). Defaults to the resource's
                              own columns; `--json` is unaffected.
      --filter=<value>...     Filter as field=operation:value (operation
                              defaults to equals). Fields: created_at.
                              Operations: equals, not_equals, contains,
                              not_contains, less_than, less_than_or_equal,
                              greater_than, greater_than_or_equal.
      --limit=<value>         Page size (server default 20, max 100).
      --page-token=<value>    Continue from a previous page's next_page_token.
      --plain                 Tab-separated rows with no header, for piping.
                              Implied when stdout is not a terminal.
      --sort=<value>          Sort as field:direction (asc|desc). Fields:
                              created_at.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List projects.

EXAMPLES
  $ zitadel projects list --json

  $ zitadel projects list --all --json

  $ zitadel projects list --filter created_at=equals:<value> --sort created_at:desc
```

## `zitadel projects update ID`

Update a project by id.

```
USAGE
  $ zitadel projects update ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--name <value>] [--data
    <value> | --file <value>] [-e development|preview|production]

ARGUMENTS
  ID  project id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

RAW BODY FLAGS
  --data=<value>  Whole body as a JSON object, instead of the field flags.
  --file=<value>  Read the body from a JSON file; `-` reads stdin.

GLOBAL FLAGS
  --json  Format output as json.

OPTIONAL FIELD FLAGS
  --name=<value>  The name of the project.

DESCRIPTION
  Update a project by id.

EXAMPLES
  $ zitadel projects update <id> --data '{...}' --json

  $ zitadel projects update <id> --file ./project.json
```

## `zitadel reset`

Delete the local Zitadel server runtime and data.

```
USAGE
  $ zitadel reset [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [-f]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Delete the local runtime and its data without the
                         confirmation prompt.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Delete the local Zitadel server runtime and data.
```

## `zitadel resources`

List the resources this CLI manages and what can be done to each.

```
USAGE
  $ zitadel resources [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List the resources this CLI manages and what can be done to each.

EXAMPLES
  $ zitadel resources

  $ zitadel resources --json

  $ zitadel resources --json | jq -r '.data.resources[] | "\(.topic): \(.verbs | join(", "))"'
```

## `zitadel schemas list`

List revisions of a user-schema by objectType.

```
USAGE
  $ zitadel schemas list -t <value> [--json] [-c <value>] [-s <value>]
    [-n] [--dry-run] [--verbose] [--debug] [--telemetry] [-e
    development|preview|production]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
  -t, --object-type=<value>   (required) Filter revisions by objectType (e.g.
                              human-user).
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List revisions of a user-schema by objectType.
```

## `zitadel search`

Search for a command.

```
USAGE
  $ zitadel search

DESCRIPTION
  Search for a command.

  Once you select a command, hit enter and it will show the help for that
  command.
```

_See code: [@oclif/plugin-search](https://github.com/oclif/plugin-search/blob/v1.2.50/src/commands/search.ts)_

## `zitadel sessions get ID`

Get one session by id.

```
USAGE
  $ zitadel sessions get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--fields <value>] [-e
    development|preview|production]

ARGUMENTS
  ID  session id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --fields=<value>        Fields to show, comma-separated dot-paths.
                              Defaults to the resource's own; `--json` is
                              unaffected.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one session by id.

EXAMPLES
  $ zitadel sessions get <id>

  $ zitadel sessions get <id> --json
```

## `zitadel sessions list`

List sessions.

```
USAGE
  $ zitadel sessions list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--limit <value>] [-a |
    --page-token <value>] [--fields <value>] [--plain] [--filter <value>...]
    [--sort <value>] [-e development|preview|production]

FLAGS
  -a, --all
      Fetch every page instead of one.

  -c, --cwd=<value>
      Project directory to operate on.

  -e, --environment=<option>
      Target environment (default: development).
      <options: development|preview|production>

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  --debug
      Debug logging.

  --dry-run
      Preview without mutating files or the platform.

  --fields=<value>
      Columns to show, comma-separated dot-paths (e.g. id,attributes.email).
      Defaults to the resource's own columns; `--json` is unaffected.

  --filter=<value>...
      Filter as field=operation:value (operation defaults to equals). Fields:
      created_at, user_id, state, lifecycle_owner_team_id. Operations: equals,
      not_equals, contains, not_contains, less_than, less_than_or_equal,
      greater_than, greater_than_or_equal.

  --limit=<value>
      Page size (server default 20, max 100).

  --page-token=<value>
      Continue from a previous page's next_page_token.

  --plain
      Tab-separated rows with no header, for piping. Implied when stdout is not a
      terminal.

  --sort=<value>
      Sort as field:direction (asc|desc). Fields: created_at, user_id.

  --[no-]telemetry
      Send anonymous usage analytics. Disable with --no-telemetry.

  --verbose
      Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List sessions.

EXAMPLES
  $ zitadel sessions list --json

  $ zitadel sessions list --all --json

  $ zitadel sessions list --filter created_at=equals:<value> --sort created_at:desc
```

## `zitadel sessions revoke ID`

Revoke a session by id.

```
USAGE
  $ zitadel sessions revoke ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [-f] [-e
    development|preview|production]

ARGUMENTS
  ID  session id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -f, --force                 Revoke the session without the confirmation
                              prompt. Required when non-interactive.
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Revoke a session by id.

EXAMPLES
  $ zitadel sessions revoke <id> --force --json
```

## `zitadel setup`

Create a Zitadel project and scaffold local auth.

```
USAGE
  $ zitadel setup [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [-f] [--framework
    next|nuxt|react|vue|solid|svelte|qwik|angular] [--renderer react]
    [--dev-port <value>] [--skip-install] [--preset
    password-first|passkey-first] [--use-case minimal|consumer|business]
    [--design centered|split|split-right|hero|minimal]

FLAGS
  -c, --cwd=<value>
      Project directory to operate on.

  -f, --force
      Overwrite managed files that already exist.

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  --debug
      Debug logging.

  --design=<option>
      Login design to eject into .zitadel/branding/ and publish as branding
      revision 1. Skips the wizard's design question. When omitted in
      non-interactive runs, the login uses the built-in template; run the
      `branding eject` command later to customize. Split-family designs (split,
      split-right, hero) collapse their brand pane by container width: narrow
      containers — including widget-posture embeds at card width — render the
      compact brand mark instead (logo_url, else hero_url, from
      .zitadel/branding/branding.json; hero falls back to editable text).
      <options: centered|split|split-right|hero|minimal>

  --dev-port=<value>
      Dev-server port; also the issuer origin registered with Zitadel. Defaults to
      the detected port. Use distinct ports to run several scaffolded apps side by
      side.

  --dry-run
      Preview without mutating files or the platform.

  --framework=<option>
      Framework to target.
      <options: next|nuxt|react|vue|solid|svelte|qwik|angular>

  --preset=<option>
      Sign-in preset for the scaffolded schema and login flow (default:
      password-first).
      <options: password-first|passkey-first>

  --renderer=<option>
      Renderer (default: react). Not yet available: web-component.
      <options: react>

  --skip-install
      Do not install dependencies after setup updates package.json.

  --[no-]telemetry
      Send anonymous usage analytics. Disable with --no-telemetry.

  --use-case=<option>
      Use case for the scaffolded schema fields: who signs in to the app (default:
      minimal).
      <options: minimal|consumer|business>

  --verbose
      Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Create a Zitadel project and scaffold local auth.

EXAMPLES
  $ zitadel setup --framework next

  $ zitadel setup --framework react --dev-port 3000
```

## `zitadel start`

Start a local Zitadel server.

```
USAGE
  $ zitadel start [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--image <value>] [--port
    <value>] [--runtime binary|docker]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --image=<value>     Container image to run.
      --port=<value>      [default: 8080] Local HTTP port.
      --runtime=<option>  Local runtime backend.
                          <options: binary|docker>
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Start a local Zitadel server.
```

## `zitadel status`

Summarize the local Zitadel server and project state.

```
USAGE
  $ zitadel status [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Summarize the local Zitadel server and project state.
```

## `zitadel stop`

Stop the local Zitadel server.

```
USAGE
  $ zitadel stop [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--all]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
      --all              Stop all discovered CLI-managed local Zitadel runtime
                         processes.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Stop the local Zitadel server.
```

## `zitadel teams create`

Create a team.

```
USAGE
  $ zitadel teams create [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--name <value>] [--data
    <value> | --file <value>] [-e development|preview|production]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

RAW BODY FLAGS
  --data=<value>  Whole body as a JSON object, instead of the field flags.
  --file=<value>  Read the body from a JSON file; `-` reads stdin.

GLOBAL FLAGS
  --json  Format output as json.

REQUIRED FIELD FLAGS
  --name=<value>  (required) The name of the team.

DESCRIPTION
  Create a team.

EXAMPLES
  $ zitadel teams create --name <name> --json

  $ zitadel teams create --data '{...}' --json

  $ zitadel teams create --file ./team.json
```

## `zitadel teams delete ID`

Delete a team by id.

```
USAGE
  $ zitadel teams delete ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [-f] [-e
    development|preview|production]

ARGUMENTS
  ID  team id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -f, --force                 Delete the team without the confirmation prompt.
                              Required when non-interactive.
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Delete a team by id.

EXAMPLES
  $ zitadel teams delete <id> --force --json
```

## `zitadel teams get ID`

Get one team by id.

```
USAGE
  $ zitadel teams get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--fields <value>] [-e
    development|preview|production]

ARGUMENTS
  ID  team id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --fields=<value>        Fields to show, comma-separated dot-paths.
                              Defaults to the resource's own; `--json` is
                              unaffected.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one team by id.

EXAMPLES
  $ zitadel teams get <id>

  $ zitadel teams get <id> --json
```

## `zitadel teams list`

List teams.

```
USAGE
  $ zitadel teams list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--limit <value>] [-a |
    --page-token <value>] [--fields <value>] [--plain] [--filter <value>...]
    [--sort <value>] [-e development|preview|production]

FLAGS
  -a, --all                   Fetch every page instead of one.
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --fields=<value>        Columns to show, comma-separated dot-paths (e.g.
                              id,attributes.email). Defaults to the resource's
                              own columns; `--json` is unaffected.
      --filter=<value>...     Filter as field=operation:value (operation
                              defaults to equals). Fields: created_at, name,
                              status. Operations: equals, not_equals, contains,
                              not_contains, less_than, less_than_or_equal,
                              greater_than, greater_than_or_equal.
      --limit=<value>         Page size (server default 20, max 100).
      --page-token=<value>    Continue from a previous page's next_page_token.
      --plain                 Tab-separated rows with no header, for piping.
                              Implied when stdout is not a terminal.
      --sort=<value>          Sort as field:direction (asc|desc). Fields:
                              created_at, name, status.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List teams.

EXAMPLES
  $ zitadel teams list --json

  $ zitadel teams list --all --json

  $ zitadel teams list --filter created_at=equals:<value> --sort created_at:desc
```

## `zitadel teams update ID`

Update a team by id.

```
USAGE
  $ zitadel teams update ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--name <value>] [--data
    <value> | --file <value>] [-e development|preview|production]

ARGUMENTS
  ID  team id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

RAW BODY FLAGS
  --data=<value>  Whole body as a JSON object, instead of the field flags.
  --file=<value>  Read the body from a JSON file; `-` reads stdin.

GLOBAL FLAGS
  --json  Format output as json.

OPTIONAL FIELD FLAGS
  --name=<value>  The name of the team.

DESCRIPTION
  Update a team by id.

EXAMPLES
  $ zitadel teams update <id> --data '{...}' --json

  $ zitadel teams update <id> --file ./team.json
```

## `zitadel uninstall`

Remove managed files and local Zitadel state.

```
USAGE
  $ zitadel uninstall [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [-f]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Remove the managed files without the confirmation
                         prompt.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove managed files and local Zitadel state.

ALIASES
  $ zitadel uninstall
```

## `zitadel users create`

Create a user.

```
USAGE
  $ zitadel users create [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--schema <value>]
    [--attributes <value>...] [--data <value> | --file <value>] [-e
    development|preview|production]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

REQUIRED FIELD FLAGS
  --attributes=<value>...  (required) Repeatable attributes entry: key=value for
                           a string, key:=value for JSON. The user's
                           schema-defined content.
  --schema=<value>         (required) The schema that defines the content of
                           `attributes`.

RAW BODY FLAGS
  --data=<value>  Whole body as a JSON object, instead of the field flags.
  --file=<value>  Read the body from a JSON file; `-` reads stdin.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Create a user.

EXAMPLES
  $ zitadel users create --schema <schema> --attributes <key>=<value> --json

  $ zitadel users create --data '{...}' --json

  $ zitadel users create --file ./user.json
```

## `zitadel users delete ID`

Delete a user by id.

```
USAGE
  $ zitadel users delete ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [-f] [-e
    development|preview|production]

ARGUMENTS
  ID  user id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -f, --force                 Delete the user without the confirmation prompt.
                              Required when non-interactive.
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Delete a user by id.

EXAMPLES
  $ zitadel users delete <id> --force --json
```

## `zitadel users get ID`

Get one user by id.

```
USAGE
  $ zitadel users get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--fields <value>] [-e
    development|preview|production]

ARGUMENTS
  ID  user id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --fields=<value>        Fields to show, comma-separated dot-paths.
                              Defaults to the resource's own; `--json` is
                              unaffected.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one user by id.

EXAMPLES
  $ zitadel users get <id>

  $ zitadel users get <id> --json
```

## `zitadel users list`

List users.

```
USAGE
  $ zitadel users list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--limit <value>] [-a |
    --page-token <value>] [--fields <value>] [--plain] [--filter <value>...]
    [--sort <value>] [-e development|preview|production]

FLAGS
  -a, --all
      Fetch every page instead of one.

  -c, --cwd=<value>
      Project directory to operate on.

  -e, --environment=<option>
      Target environment (default: development).
      <options: development|preview|production>

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  --debug
      Debug logging.

  --dry-run
      Preview without mutating files or the platform.

  --fields=<value>
      Columns to show, comma-separated dot-paths (e.g. id,attributes.email).
      Defaults to the resource's own columns; `--json` is unaffected.

  --filter=<value>...
      Filter as field=operation:value (operation defaults to equals). Fields:
      created_at, id, schema, status, team_id, lifecycle_owner_team_id.
      Operations: equals, not_equals, contains, not_contains, less_than,
      less_than_or_equal, greater_than, greater_than_or_equal.

  --limit=<value>
      Page size (server default 20, max 100).

  --page-token=<value>
      Continue from a previous page's next_page_token.

  --plain
      Tab-separated rows with no header, for piping. Implied when stdout is not a
      terminal.

  --sort=<value>
      Sort as field:direction (asc|desc). Fields: created_at, id, schema, status,
      lifecycle_owner_team_id.

  --[no-]telemetry
      Send anonymous usage analytics. Disable with --no-telemetry.

  --verbose
      Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List users.

EXAMPLES
  $ zitadel users list --json

  $ zitadel users list --all --json

  $ zitadel users list --filter created_at=equals:<value> --sort created_at:desc
```

## `zitadel users update ID`

Update a user by id.

```
USAGE
  $ zitadel users update ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--schema <value>]
    [--attributes <value>...] [--data <value> | --file <value>] [-e
    development|preview|production]

ARGUMENTS
  ID  user id

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.
      --verbose               Verbose logging.

OPTIONAL FIELD FLAGS
  --attributes=<value>...  Repeatable attributes entry: key=value for a string,
                           key:=value for JSON. The changed attributes only.
  --schema=<value>         The schema the user follows after this patch.

RAW BODY FLAGS
  --data=<value>  Whole body as a JSON object, instead of the field flags.
  --file=<value>  Read the body from a JSON file; `-` reads stdin.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Update a user by id.

EXAMPLES
  $ zitadel users update <id> --data '{...}' --json

  $ zitadel users update <id> --file ./user.json
```

## `zitadel version`

```
USAGE
  $ zitadel version [--json] [--verbose]

FLAGS
  --verbose  Show additional information about the CLI.

GLOBAL FLAGS
  --json  Format output as json.

FLAG DESCRIPTIONS
  --verbose  Show additional information about the CLI.

    Additionally shows the architecture, node version, operating system, and
    versions of plugins that the CLI is using.
```

_See code: [@oclif/plugin-version](https://github.com/oclif/plugin-version/blob/2.2.46/src/commands/version.ts)_

## `zitadel which`

Show which plugin a command is in.

```
USAGE
  $ zitadel which [--json]

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Show which plugin a command is in.

EXAMPLES
  See which plugin the `help` command is in:

    $ zitadel which help

  Use colon separators.

    $ zitadel which foo:bar:baz

  Use spaces as separators.

    $ zitadel which foo bar baz

  Wrap command in quotes to use spaces as separators.

    $ zitadel which "foo bar baz"
```

_See code: [@oclif/plugin-which](https://github.com/oclif/plugin-which/blob/3.2.55/src/commands/which.ts)_
<!-- commandsstop -->

</details>

## Links

- Repository: [github.com/zitadel/nextgen](https://github.com/zitadel/nextgen)
- Issues: [github.com/zitadel/nextgen/issues](https://github.com/zitadel/nextgen/issues)
