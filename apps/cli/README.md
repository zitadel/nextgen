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
under `.zitadel/local/`. Remote-server setup can use `--server <url>` without
starting a local runtime. Use `--runtime docker`, `--image`, or
`ZITADEL_LOCAL_IMAGE` for advanced Docker backend debugging.
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

- `zitadel claim` — attach the project to your team (opens the claim page,
  polls for completion; team attachment then shows in `setup`, `status`, and
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
* [`zitadel help [COMMAND]`](#zitadel-help-command)
* [`zitadel logs`](#zitadel-logs)
* [`zitadel plan`](#zitadel-plan)
* [`zitadel reset`](#zitadel-reset)
* [`zitadel schemas list`](#zitadel-schemas-list)
* [`zitadel search`](#zitadel-search)
* [`zitadel setup`](#zitadel-setup)
* [`zitadel start`](#zitadel-start)
* [`zitadel status`](#zitadel-status)
* [`zitadel stop`](#zitadel-stop)
* [`zitadel uninstall`](#zitadel-uninstall)
* [`zitadel version`](#zitadel-version)
* [`zitadel which`](#zitadel-which)

## `zitadel apply`

Validate and upload repo config to the platform.

```
USAGE
  $ zitadel apply [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry] [-e development|preview|production]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -f, --force                 Overwrite protected files on conflict.
  -n, --non-interactive       Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with --no-telemetry.
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
  $ zitadel branding eject [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry] [--design centered|split|split-right|hero|minimal]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --design=<option>  Design to start from (default: centered).
                         <options: centered|split|split-right|hero|minimal>
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Take ownership of the login template: scaffold .zitadel/branding/ from a shipped design.
```

## `zitadel claim`

Attach this project to a team so it becomes permanent. Opens a browser to finish signing in.

```
USAGE
  $ zitadel claim [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry] [--no-open] [--timeout <value>]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --no-open          Print the link instead of opening a browser.
      --[no-]telemetry   Send anonymous usage analytics. Disable with --no-telemetry.
      --timeout=<value>  Seconds to wait for the browser step. Defaults to the link's own expiry (10 minutes).
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Attach this project to a team so it becomes permanent. Opens a browser to finish signing in.

EXAMPLES
  $ zitadel claim

  $ zitadel claim --no-open

  $ zitadel claim --timeout 120
```

## `zitadel commands`

List all zitadel commands.

```
USAGE
  $ zitadel commands [--json] [-c id|plugin|summary|type... | --tree] [--deprecated] [-x | ] [--hidden]
    [--no-truncate | ] [--sort id|plugin|summary|type | ]

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
  $ zitadel doctor [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry] [--fix] [--image <value>] [--port <value>] [--runtime binary|docker]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -f, --force             Overwrite protected files on conflict.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --fix               Repair missing files and stale managed wiring.
      --image=<value>     Container image to check.
      --port=<value>      [default: 8080] Local HTTP port.
      --runtime=<option>  Local runtime backend.
                          <options: binary|docker>
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
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
  $ zitadel eject [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove managed files and local Zitadel state.

ALIASES
  $ zitadel uninstall
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
  $ zitadel logs [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry] [--follow] [--tail <value>]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --follow           Follow logs.
      --tail=<value>     [default: 200] Number of lines to show.
      --[no-]telemetry   Send anonymous usage analytics. Disable with --no-telemetry.
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
  $ zitadel plan [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry] [-e development|preview|production]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -f, --force                 Overwrite protected files on conflict.
  -n, --non-interactive       Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Validate config without mutation and preview the sync diff.
```

## `zitadel reset`

Delete the local Zitadel server runtime and data.

```
USAGE
  $ zitadel reset [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Delete the local Zitadel server runtime and data.
```

## `zitadel schemas list`

List revisions of a user-schema by objectType.

```
USAGE
  $ zitadel schemas list -t <value> [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry] [-e development|preview|production]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -f, --force                 Overwrite protected files on conflict.
  -n, --non-interactive       Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>        Override the resolved server URL.
  -t, --object-type=<value>   (required) Filter revisions by objectType (e.g. human-user).
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --[no-]telemetry        Send anonymous usage analytics. Disable with --no-telemetry.
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

  Once you select a command, hit enter and it will show the help for that command.
```

_See code: [@oclif/plugin-search](https://github.com/oclif/plugin-search/blob/v1.2.50/src/commands/search.ts)_

## `zitadel setup`

Create a Zitadel project and scaffold local auth.

```
USAGE
  $ zitadel setup [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry] [--framework next|nuxt|react|vue|solid|svelte|qwik|angular] [--renderer react] [--dev-port <value>]
    [--skip-install] [--preset password-first|passkey-first] [--use-case minimal|consumer|business] [--design
    centered|split|split-right|hero|minimal]

FLAGS
  -c, --cwd=<value>         Project directory to operate on.
  -f, --force               Overwrite protected files on conflict.
  -n, --non-interactive     Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>      Override the resolved server URL.
      --debug               Debug logging.
      --design=<option>     Login design to eject into .zitadel/branding/ and publish as branding revision 1. Skips the
                            wizard's design question. When omitted in non-interactive runs, the login uses the built-in
                            template; run the `branding eject` command later to customize.
                            <options: centered|split|split-right|hero|minimal>
      --dev-port=<value>    Dev-server port; also the issuer origin registered with Zitadel. Defaults to the detected
                            port. Use distinct ports to run several scaffolded apps side by side.
      --dry-run             Preview without mutating files or the platform.
      --framework=<option>  Framework to target.
                            <options: next|nuxt|react|vue|solid|svelte|qwik|angular>
      --preset=<option>     Sign-in preset for the scaffolded schema and login flow (default: password-first).
                            <options: password-first|passkey-first>
      --renderer=<option>   Renderer (default: react). Not yet available: web-component.
                            <options: react>
      --skip-install        Do not install dependencies after setup updates package.json.
      --[no-]telemetry      Send anonymous usage analytics. Disable with --no-telemetry.
      --use-case=<option>   Use case for the scaffolded schema fields: who signs in to the app (default: minimal).
                            <options: minimal|consumer|business>
      --verbose             Verbose logging.

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
  $ zitadel start [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry] [--image <value>] [--port <value>] [--runtime binary|docker]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -f, --force             Overwrite protected files on conflict.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --image=<value>     Container image to run.
      --port=<value>      [default: 8080] Local HTTP port.
      --runtime=<option>  Local runtime backend.
                          <options: binary|docker>
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
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
  $ zitadel status [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with --no-telemetry.
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
  $ zitadel stop [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry] [--all]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --all              Stop all discovered CLI-managed local Zitadel runtime processes.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Stop the local Zitadel server.
```

## `zitadel uninstall`

Remove managed files and local Zitadel state.

```
USAGE
  $ zitadel uninstall [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]
    [--telemetry]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove managed files and local Zitadel state.

ALIASES
  $ zitadel uninstall
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

    Additionally shows the architecture, node version, operating system, and versions of plugins that the CLI is using.
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
