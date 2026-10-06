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
`start` also creates a local admin, `admin@zitadel.localhost`, and ends by
printing a one-time sign-in link for the management console.
`setup --server local` creates a project on that local server, asks which
framework to scaffold when the directory is fresh, writes the app into the
current directory, and scaffolds the framework's
idiomatic auth routes plus the proxy layer — for Next.js that means
`app/login`, `app/register`, `app/profile`, and `proxy.ts` for Next 16+ or
`middleware.ts` for older versions; other frameworks get their equivalents
from the same patcher system. In a pre-existing app, setup derives the
embedding posture from the app instead of assuming a fresh skeleton: the
scaffolded pages take the `variant="widget"` posture inside your app's own
shell, recorded in the scaffold manifest and verified by `doctor`. Fresh
scaffolds also replace the starter home page with a redirect to `/login`.
Against a local server started with the default platform bootstrap, setup also
attaches the new project to the local admin's team, so the project is owned
from the start and `zitadel claim` reports it as already owned. If you opted
out with `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=false`, there is no local admin
and the project has no owning team; that server cannot claim projects.
Setup writes `.env.local` and `.zitadel/`, and installs
dependencies with the detected package manager. Pass `--skip-install` to install
them yourself. The project's default user schema and login flow are provisioned
from versioned local defaults; setup writes editable copies into
`.zitadel/schemas/default-human-user.json` and
`.zitadel/flows/default-login.json`, uploads them through the schema and flow
APIs, then seeds `.zitadel/state.json` so `zitadel plan` is immediately empty.
Open the dev server URL printed by your framework, register a user, log out,
log back in, and end on the signed-in profile page. That user is an end user
of your app. The management console is a separate sign-in: run
`zitadel console` for a fresh one-time link as the local admin.

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
(`--design centered|minimal`); setup never does;
every edit publishes a new immutable branding revision and the login serves
the newest one. Flows work the same way: every edit publishes a new immutable
flow revision. A page that pins `flow-name` gets that flow's newest revision. A
page without a pin gets the project's newest active unscoped flow, whatever its
name, so revising a flow can make it the default.

For agent scripts, pass `--non-interactive --json` and capture stdout and stderr
separately. The CLI contract is one parseable JSON object on stdout; terminals
and agent UIs may display stderr package-manager progress together with stdout.

## Other commands

- `zitadel claim`: claim the project to make it permanent (opens the claim
  page, polls for completion; the claim then shows in `setup`, `status`, and
  `doctor`)
- `zitadel console`: print a fresh one-time sign-in link for the local
  console as `admin@zitadel.localhost` and open it in a browser
  (`--no-open` prints the link only)
- `zitadel doctor`: verify the local runtime and generated project files
  (including scaffold drift and dependency-version alignment)
- `zitadel status`: summarise the local runtime and project
- `zitadel plan`: validate config and preview sync changes without mutation
- `zitadel apply`: validate and upload repo config to Zitadel
- `zitadel deploy`: build a release from `.zitadel/` and deploy it to the
  project default and every primary origin
- `zitadel preview`: in a platform build, deploy the release to this build's
  preview URLs for a limited time (`preview rm <url>` retires one)
- `zitadel deployments`: the deployment log, or `--live` for what every
  target serves
- `zitadel rollback`: undo the newest deploy on every target it moved
- `zitadel allowlist`: list, `add --kind primary|preview`, and `rm` the
  project's allowed origin patterns
- `zitadel env`: show which server and project this directory resolves to;
  `env add <name>` binds another project through `.env.<name>.local`
- `zitadel branding eject`: scaffold an editable login template from a design
- `zitadel schemas list`: list the project's user schemas
- `zitadel vars list|get|set|rm|resolve`: manage the project's variables and
  secrets; `--preview` addresses the value previews get
- `zitadel eject`: remove what setup wrote (alias: `zitadel uninstall`)
- `zitadel start|stop|logs|reset`: manage the local runtime

The full agent-facing contract (JSON envelope, posture rules, claim flow,
doctor repair) is [`SKILLS.md`](https://github.com/zitadel/nextgen/blob/main/apps/cli/SKILLS.md),
which ships in this package.

## Reference

<details>
<summary>Full command reference</summary>

<!-- commands -->
* [`zitadel allowlist`](#zitadel-allowlist)
* [`zitadel allowlist add PATTERN`](#zitadel-allowlist-add-pattern)
* [`zitadel allowlist rm PATTERN`](#zitadel-allowlist-rm-pattern)
* [`zitadel apply`](#zitadel-apply)
* [`zitadel autocomplete [SHELL]`](#zitadel-autocomplete-shell)
* [`zitadel branding eject`](#zitadel-branding-eject)
* [`zitadel branding get ID`](#zitadel-branding-get-id)
* [`zitadel branding list`](#zitadel-branding-list)
* [`zitadel claim`](#zitadel-claim)
* [`zitadel commands`](#zitadel-commands)
* [`zitadel console`](#zitadel-console)
* [`zitadel deploy`](#zitadel-deploy)
* [`zitadel deployments`](#zitadel-deployments)
* [`zitadel doctor`](#zitadel-doctor)
* [`zitadel eject`](#zitadel-eject)
* [`zitadel env`](#zitadel-env)
* [`zitadel env add NAME`](#zitadel-env-add-name)
* [`zitadel env list`](#zitadel-env-list)
* [`zitadel events get ID`](#zitadel-events-get-id)
* [`zitadel events list`](#zitadel-events-list)
* [`zitadel flow-definitions get FLOW`](#zitadel-flow-definitions-get-flow)
* [`zitadel flow-definitions list`](#zitadel-flow-definitions-list)
* [`zitadel grants create`](#zitadel-grants-create)
* [`zitadel grants delete ID`](#zitadel-grants-delete-id)
* [`zitadel grants get ID`](#zitadel-grants-get-id)
* [`zitadel grants list`](#zitadel-grants-list)
* [`zitadel help [COMMAND]`](#zitadel-help-command)
* [`zitadel idps create`](#zitadel-idps-create)
* [`zitadel idps get ID`](#zitadel-idps-get-id)
* [`zitadel idps list`](#zitadel-idps-list)
* [`zitadel logs`](#zitadel-logs)
* [`zitadel plan`](#zitadel-plan)
* [`zitadel preview`](#zitadel-preview)
* [`zitadel preview rm URL`](#zitadel-preview-rm-url)
* [`zitadel projects demote`](#zitadel-projects-demote)
* [`zitadel projects get ID`](#zitadel-projects-get-id)
* [`zitadel projects list`](#zitadel-projects-list)
* [`zitadel projects promote`](#zitadel-projects-promote)
* [`zitadel projects update ID`](#zitadel-projects-update-id)
* [`zitadel releases get ID`](#zitadel-releases-get-id)
* [`zitadel releases list`](#zitadel-releases-list)
* [`zitadel releases revoke ID`](#zitadel-releases-revoke-id)
* [`zitadel reset`](#zitadel-reset)
* [`zitadel resources`](#zitadel-resources)
* [`zitadel rollback`](#zitadel-rollback)
* [`zitadel schemas get SCHEMA`](#zitadel-schemas-get-schema)
* [`zitadel schemas list`](#zitadel-schemas-list)
* [`zitadel search`](#zitadel-search)
* [`zitadel sessions get ID`](#zitadel-sessions-get-id)
* [`zitadel sessions list`](#zitadel-sessions-list)
* [`zitadel sessions revoke ID`](#zitadel-sessions-revoke-id)
* [`zitadel setup`](#zitadel-setup)
* [`zitadel sso enable`](#zitadel-sso-enable)
* [`zitadel start`](#zitadel-start)
* [`zitadel status`](#zitadel-status)
* [`zitadel stop`](#zitadel-stop)
* [`zitadel teams create`](#zitadel-teams-create)
* [`zitadel teams deactivate ID`](#zitadel-teams-deactivate-id)
* [`zitadel teams get ID`](#zitadel-teams-get-id)
* [`zitadel teams list`](#zitadel-teams-list)
* [`zitadel teams update ID`](#zitadel-teams-update-id)
* [`zitadel uninstall`](#zitadel-uninstall)
* [`zitadel users create`](#zitadel-users-create)
* [`zitadel users delete ID`](#zitadel-users-delete-id)
* [`zitadel users get ID`](#zitadel-users-get-id)
* [`zitadel users list`](#zitadel-users-list)
* [`zitadel users update ID`](#zitadel-users-update-id)
* [`zitadel vars get NAME`](#zitadel-vars-get-name)
* [`zitadel vars list`](#zitadel-vars-list)
* [`zitadel vars resolve`](#zitadel-vars-resolve)
* [`zitadel vars rm NAME`](#zitadel-vars-rm-name)
* [`zitadel vars set NAME`](#zitadel-vars-set-name)
* [`zitadel version`](#zitadel-version)
* [`zitadel which`](#zitadel-which)

## `zitadel allowlist`

List the project's allowed origin patterns.

```
USAGE
  $ zitadel allowlist [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--plain]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --plain             Tab-separated rows with no header, for piping.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List the project's allowed origin patterns.

EXAMPLES
  $ zitadel allowlist

  $ zitadel allowlist --json
```

## `zitadel allowlist add PATTERN`

Add an allowed origin pattern to the project.

```
USAGE
  $ zitadel allowlist add PATTERN --kind primary|preview [--json] [-c <value>] [-s <value>] [-e <value>]
    [--env-file <value>] [-n] [--dry-run] [--verbose] [--debug] [--telemetry]

ARGUMENTS
  PATTERN  An origin, or a pattern with one `*` label.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --kind=<option>     (required) primary admits requests; preview only bounds what a preview deploy may register.
                          <options: primary|preview>
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Add an allowed origin pattern to the project.

EXAMPLES
  $ zitadel allowlist add https://app.acme.com --kind primary

  $ zitadel allowlist add 'https://*-acmeinc.vercel.app' --kind preview
```

## `zitadel allowlist rm PATTERN`

Remove an allowed origin pattern from the project.

```
USAGE
  $ zitadel allowlist rm PATTERN [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry]

ARGUMENTS
  PATTERN  The pattern to remove, exactly as listed.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove an allowed origin pattern from the project.

EXAMPLES
  $ zitadel allowlist rm https://old.acme.com
```

## `zitadel apply`

Validate and upload repo config to the platform.

```
USAGE
  $ zitadel apply [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

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
  $ zitadel branding eject [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [-f] [--design <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -f, --force             Overwrite an existing branding file.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --design=<value>    Design to start from: centered or minimal (default: centered).
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Take ownership of the login template: scaffold .zitadel/branding/ from a shipped design.
```

## `zitadel branding get ID`

Get one branding revision by id.

```
USAGE
  $ zitadel branding get ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--fields <value>]

ARGUMENTS
  ID  branding revision id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is
                          unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one branding revision by id.

EXAMPLES
  $ zitadel branding get <id>

  $ zitadel branding get <id> --json
```

## `zitadel branding list`

List branding.

```
USAGE
  $ zitadel branding list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--fields <value>] [--plain]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --fields=<value>    Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the
                          resource's own columns; `--json` is unaffected.
      --plain             Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List branding.

EXAMPLES
  $ zitadel branding list --json
```

## `zitadel claim`

Claim this project to make it permanent. Opens a browser to create an account or sign in.

```
USAGE
  $ zitadel claim [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--no-open] [--timeout <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --no-open           Print the link instead of opening a browser.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --timeout=<value>   Seconds to wait for the browser step. Defaults to the link's own expiry (10 minutes).
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Claim this project to make it permanent. Opens a browser to create an account or sign in.

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

## `zitadel console`

Open the local console, signed in as the local admin created by `zitadel start`.

```
USAGE
  $ zitadel console [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--no-open]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --no-open           Print the sign-in link instead of opening a browser.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Open the local console, signed in as the local admin created by `zitadel start`.

EXAMPLES
  $ zitadel console

  $ zitadel console --no-open
```

## `zitadel deploy`

Build a release from .zitadel/ and deploy it to the project default and primary origins.

```
USAGE
  $ zitadel deploy [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [-m <value>] [--origin <value>...]

FLAGS
  -c, --cwd=<value>        Project directory to operate on.
  -e, --env=<value>        Environment whose .env.<name>.local file binds the server and project.
  -m, --message=<value>    Summary recorded on the release and the deploy.
  -n, --non-interactive    Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>     Override the resolved server URL.
      --debug              Debug logging.
      --dry-run            Preview without mutating files or the platform.
      --env-file=<value>   Read the server and project from this file instead of the .env convention.
      --origin=<value>...  Deploy to one primary origin only. Repeatable. A preview URL is refused.
      --[no-]telemetry     Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose            Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Build a release from .zitadel/ and deploy it to the project default and primary origins.

EXAMPLES
  $ zitadel deploy -m 'add phone_number to human-user'

  $ zitadel deploy --env production

  $ zitadel deploy --origin https://staging.acme.com
```

## `zitadel deployments`

List the deployment log, or what every target serves with --live.

```
USAGE
  $ zitadel deployments [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--live] [--origin <value>] [--deploy <value>] [--plain]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --deploy=<value>    The rows one deploy wrote.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --live              The newest row per target: what each one serves.
      --origin=<value>    One target's history. Use 'default' for the project default.
      --plain             Tab-separated rows with no header, for piping.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List the deployment log, or what every target serves with --live.

EXAMPLES
  $ zitadel deployments

  $ zitadel deployments --live

  $ zitadel deployments --origin https://app.acme.com

  $ zitadel deployments --deploy dpl_01KB3F8N2P9S5WQY
```

## `zitadel doctor`

Verify local runtime and project state.

```
USAGE
  $ zitadel doctor [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--fix] [--image <value>] [--port <value>] [--runtime binary|docker]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
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
  $ zitadel eject [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [-f]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -f, --force             Remove the managed files without the confirmation prompt.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove managed files and local Zitadel state.

ALIASES
  $ zitadel uninstall
```

## `zitadel env`

Show which server and project this directory resolves to, and from where.

```
USAGE
  $ zitadel env [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Show which server and project this directory resolves to, and from where.

EXAMPLES
  $ zitadel env

  $ zitadel env --env production

  $ zitadel env --env-file ./infra/acme-staging.env
```

## `zitadel env add NAME`

Bind an environment to a project, creating the project if needed.

```
USAGE
  $ zitadel env add NAME [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--project <value>] [--name <value>] [--origin <value>...]
    [--preview <value>...] [--force]

ARGUMENTS
  NAME  The environment name, e.g. production.

FLAGS
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive     Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>      Override the resolved server URL.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read the server and project from this file instead of the .env convention.
      --force               Overwrite an existing .env.<name>.local.
      --name=<value>        The name for a project this command creates.
      --origin=<value>...   A production origin to allow (primary). Repeatable.
      --preview=<value>...  A pattern the preview credential may register URLs under. Repeatable.
      --project=<value>     Bind this existing project instead of creating one.
      --[no-]telemetry      Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose             Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Bind an environment to a project, creating the project if needed.

EXAMPLES
  $ zitadel env add production

  $ zitadel env add production --origin https://app.acme.com --preview 'https://*-acmeinc.vercel.app'

  $ zitadel env add production --server https://api.zitadel.cloud --project proj_01K9AA9M3K7E2QX8VB4T
```

## `zitadel env list`

List the environments bound in this directory's .env files.

```
USAGE
  $ zitadel env list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List the environments bound in this directory's .env files.

EXAMPLES
  $ zitadel env list
```

## `zitadel events get ID`

Get one event by id.

```
USAGE
  $ zitadel events get ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--fields <value>]

ARGUMENTS
  ID  event id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is
                          unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

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
  $ zitadel events list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--limit <value>] [-a | --page-token <value>] [--fields <value>] [--plain]
    [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive     Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>      Override the resolved server URL.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read the server and project from this file instead of the .env convention.
      --fields=<value>      Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the
                            resource's own columns; `--json` is unaffected.
      --filter=<value>...   Filter as field=operation:value (operation defaults to equals). Fields: category (equals;
                            values request|auth|session|admin|entity|signal; repeats widen), event_type (equals; repeats
                            widen), actor_id (equals), session_id (equals), flow_id (equals), request_id (equals),
                            entity_type (equals), entity_id (equals), team_id (equals), created_at
                            (greater_than_or_equal|less_than).
      --limit=<value>       Page size (server default 20, max 100).
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.
      --sort=<value>        Sort as field:direction (asc|desc). Fields: occurred_at.
      --[no-]telemetry      Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose             Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List events.

EXAMPLES
  $ zitadel events list --json

  $ zitadel events list --all --json

  $ zitadel events list --filter category=equals:<value> --sort occurred_at:desc
```

## `zitadel flow-definitions get FLOW`

Get one flow definition by id.

```
USAGE
  $ zitadel flow-definitions get FLOW [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--fields <value>]

ARGUMENTS
  FLOW  flow name (newest revision) or revision id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is
                          unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one flow definition by id.

EXAMPLES
  $ zitadel flow-definitions get <id>

  $ zitadel flow-definitions get <id> --json
```

## `zitadel flow-definitions list`

List flow-definitions.

```
USAGE
  $ zitadel flow-definitions list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--limit <value>] [-a | --page-token <value>] [--fields <value>] [--plain]
    [--filter <value>...]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive     Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>      Override the resolved server URL.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read the server and project from this file instead of the .env convention.
      --fields=<value>      Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the
                            resource's own columns; `--json` is unaffected.
      --filter=<value>...   Filter as field=operation:value (operation defaults to equals). Fields: name (equals),
                            purpose (equals), revisions (equals; values all|latest).
      --limit=<value>       Page size (server default 20, max 100).
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.
      --[no-]telemetry      Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose             Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List flow-definitions.

EXAMPLES
  $ zitadel flow-definitions list --json

  $ zitadel flow-definitions list --all --json

  $ zitadel flow-definitions list --filter name=equals:<value>
```

## `zitadel grants create`

Create a grant.

```
USAGE
  $ zitadel grants create [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--relation viewer|editor|admin] [--expires-at <value>] [--data <value> | --file
    <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

RAW BODY FLAGS
  --data=<value>  Whole body as a JSON object, instead of the field flags.
  --file=<value>  Read the body from a JSON file; `-` reads stdin.

OPTIONAL FIELD FLAGS
  --expires-at=<value>  Optional expiry.

GLOBAL FLAGS
  --json  Format output as json.

REQUIRED FIELD FLAGS
  --relation=<option>  (required) Catalog relation on `object_type` `project`.
                       <options: viewer|editor|admin>

DESCRIPTION
  Create a grant.

EXAMPLES
  $ zitadel grants create --data '{...}' --json

  $ zitadel grants create --file ./grant.json
```

## `zitadel grants delete ID`

Delete a grant by id.

```
USAGE
  $ zitadel grants delete ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [-f]

ARGUMENTS
  ID  grant id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -f, --force             Delete the grant without the confirmation prompt. Required when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

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
  $ zitadel grants get ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--fields <value>]

ARGUMENTS
  ID  grant id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is
                          unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

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
  $ zitadel grants list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--limit <value>] [-a | --page-token <value>] [--fields <value>] [--plain]
    [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all
      Fetch every page instead of one.

  -c, --cwd=<value>
      Project directory to operate on.

  -e, --env=<value>
      Environment whose .env.<name>.local file binds the server and project.

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  --debug
      Debug logging.

  --dry-run
      Preview without mutating files or the platform.

  --env-file=<value>
      Read the server and project from this file instead of the .env convention.

  --fields=<value>
      Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the resource's own columns;
      `--json` is unaffected.

  --filter=<value>...
      Filter as field=operation:value (operation defaults to equals). Fields: created_at
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal), user_id
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal), team_id
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal), relation
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal),
      expires_at
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal).

  --limit=<value>
      Page size (server default 20, max 100).

  --page-token=<value>
      Continue from a previous page's next_page_token.

  --plain
      Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.

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

## `zitadel idps create`

Create an identity provider connection.

```
USAGE
  $ zitadel idps create [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--data <value> | --file <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

RAW BODY FLAGS
  --data=<value>  Whole body as a JSON object, instead of the field flags.
  --file=<value>  Read the body from a JSON file; `-` reads stdin.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Create an identity provider connection.

EXAMPLES
  $ zitadel idps create --data '{...}' --json

  $ zitadel idps create --file ./identity provider connection.json
```

## `zitadel idps get ID`

Get one identity provider connection by id.

```
USAGE
  $ zitadel idps get ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--fields <value>]

ARGUMENTS
  ID  identity provider connection id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is
                          unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one identity provider connection by id.

EXAMPLES
  $ zitadel idps get <id>

  $ zitadel idps get <id> --json
```

## `zitadel idps list`

List idps.

```
USAGE
  $ zitadel idps list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--limit <value>] [-a | --page-token <value>] [--fields <value>] [--plain]
    [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive     Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>      Override the resolved server URL.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read the server and project from this file instead of the .env convention.
      --fields=<value>      Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the
                            resource's own columns; `--json` is unaffected.
      --filter=<value>...   Filter as field=operation:value (operation defaults to equals). Fields: slug (equals|not_equ
                            als|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal),
                            created_at (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_tha
                            n|greater_than_or_equal).
      --limit=<value>       Page size (server default 20, max 100).
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.
      --sort=<value>        Sort as field:direction (asc|desc). Fields: slug, created_at.
      --[no-]telemetry      Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose             Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List idps.

EXAMPLES
  $ zitadel idps list --json

  $ zitadel idps list --all --json

  $ zitadel idps list --filter slug=equals:<value> --sort slug:desc
```

## `zitadel logs`

Show local Zitadel server logs.

```
USAGE
  $ zitadel logs [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--follow] [--tail <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --follow            Follow logs.
      --tail=<value>      [default: 200] Number of lines to show.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Show local Zitadel server logs.
```

## `zitadel plan`

Validate config without mutation and preview the sync diff.

```
USAGE
  $ zitadel plan [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Validate config without mutation and preview the sync diff.
```

## `zitadel preview`

Build a release and deploy it to this build's preview URLs, for a limited time.

```
USAGE
  $ zitadel preview [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--origin <value>...] [--ttl <value>] [-m <value>] [--strict]

FLAGS
  -c, --cwd=<value>        Project directory to operate on.
  -e, --env=<value>        Environment whose .env.<name>.local file binds the server and project.
  -m, --message=<value>    Summary recorded on the release and the deploy.
  -n, --non-interactive    Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>     Override the resolved server URL.
      --debug              Debug logging.
      --dry-run            Preview without mutating files or the platform.
      --env-file=<value>   Read the server and project from this file instead of the .env convention.
      --origin=<value>...  A preview URL to deploy to. Repeatable.
      --strict             Fail instead of warning when no preview credential is present.
      --[no-]telemetry     Send anonymous usage analytics. Disable with --no-telemetry.
      --ttl=<value>        [default: 7d] How long the preview stays live, renewed on each run.
      --verbose            Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Build a release and deploy it to this build's preview URLs, for a limited time.

EXAMPLES
  $ zitadel preview

  $ zitadel preview --ttl 7d --origin https://acme-git-sso-acmeinc.vercel.app

  $ zitadel preview --strict
```

## `zitadel preview rm URL`

Retire a preview URL; its deployment records are kept.

```
USAGE
  $ zitadel preview rm URL [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry]

ARGUMENTS
  URL  The preview URL to retire.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Retire a preview URL; its deployment records are kept.

EXAMPLES
  $ zitadel preview rm https://acme-git-sso-acmeinc.vercel.app
```

## `zitadel projects demote`

Demote the project to class sandbox.

```
USAGE
  $ zitadel projects demote [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--confirm]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --confirm           Confirm without the prompt. Required when non-interactive.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Demote the project to class sandbox.

EXAMPLES
  $ zitadel projects demote --env production --confirm
```

## `zitadel projects get ID`

Get one project by id.

```
USAGE
  $ zitadel projects get ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--fields <value>]

ARGUMENTS
  ID  project id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is
                          unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

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
  $ zitadel projects list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--limit <value>] [-a | --page-token <value>] [--fields <value>] [--plain]
    [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive     Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>      Override the resolved server URL.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read the server and project from this file instead of the .env convention.
      --fields=<value>      Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the
                            resource's own columns; `--json` is unaffected.
      --filter=<value>...   Filter as field=operation:value (operation defaults to equals). Fields: created_at
                            (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_t
                            han_or_equal).
      --limit=<value>       Page size (server default 20, max 100).
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.
      --sort=<value>        Sort as field:direction (asc|desc). Fields: created_at.
      --[no-]telemetry      Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose             Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List projects.

EXAMPLES
  $ zitadel projects list --json

  $ zitadel projects list --all --json

  $ zitadel projects list --filter created_at=equals:<value> --sort created_at:desc
```

## `zitadel projects promote`

Promote the project to class production.

```
USAGE
  $ zitadel projects promote [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Promote the project to class production.

EXAMPLES
  $ zitadel projects promote --env production
```

## `zitadel projects update ID`

Update a project by id.

```
USAGE
  $ zitadel projects update ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--name <value>] [--password-hash <value>] [--data <value> | --file <value>]

ARGUMENTS
  ID  project id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

RAW BODY FLAGS
  --data=<value>  Whole body as a JSON object, instead of the field flags.
  --file=<value>  Read the body from a JSON file; `-` reads stdin.

GLOBAL FLAGS
  --json  Format output as json.

OPTIONAL FIELD FLAGS
  --name=<value>           The name of the project.
  --password-hash=<value>  The method this project's passwords are hashed with.

DESCRIPTION
  Update a project by id.

EXAMPLES
  $ zitadel projects update <id> --data '{...}' --json

  $ zitadel projects update <id> --file ./project.json
```

## `zitadel releases get ID`

Get one release by id.

```
USAGE
  $ zitadel releases get ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--fields <value>]

ARGUMENTS
  ID  release id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is
                          unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one release by id.

EXAMPLES
  $ zitadel releases get <id>

  $ zitadel releases get <id> --json
```

## `zitadel releases list`

List releases.

```
USAGE
  $ zitadel releases list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--limit <value>] [-a | --page-token <value>] [--fields <value>] [--plain]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive     Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>      Override the resolved server URL.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read the server and project from this file instead of the .env convention.
      --fields=<value>      Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the
                            resource's own columns; `--json` is unaffected.
      --limit=<value>       Page size (server default 20, max 100).
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.
      --[no-]telemetry      Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose             Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List releases.

EXAMPLES
  $ zitadel releases list --json

  $ zitadel releases list --all --json
```

## `zitadel releases revoke ID`

Revoke a release so nothing serves it, pinned or not.

```
USAGE
  $ zitadel releases revoke ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry]

ARGUMENTS
  ID  The release id.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Revoke a release so nothing serves it, pinned or not.

EXAMPLES
  $ zitadel releases revoke rel_01KX3RG8A7F0N9WD3P2E4YM5C1
```

## `zitadel reset`

Delete the local Zitadel server runtime and data.

```
USAGE
  $ zitadel reset [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [-f]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -f, --force             Delete the local runtime and its data without the confirmation prompt.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Delete the local Zitadel server runtime and data.
```

## `zitadel resources`

List the resources this CLI manages and what can be done to each.

```
USAGE
  $ zitadel resources [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List the resources this CLI manages and what can be done to each.

EXAMPLES
  $ zitadel resources

  $ zitadel resources --json

  $ zitadel resources --json | jq -r '.data.resources[] | "\(.topic): \(.verbs | join(", "))"'
```

## `zitadel rollback`

Undo the newest deploy, or go back to an earlier one with --to.

```
USAGE
  $ zitadel rollback [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--to <value>] [--origin <value>] [-m <value>] [-f]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -f, --force             Skip the confirmation. Required when non-interactive.
  -m, --message=<value>   Summary recorded on the rollback.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --origin=<value>    Narrow the rollback to one target ('default' for the project default).
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --to=<value>        Re-apply what this deploy set on every target it touched.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Undo the newest deploy, or go back to an earlier one with --to.

EXAMPLES
  $ zitadel rollback

  $ zitadel rollback --to dpl_01KB3F8N2P9S5WQV

  $ zitadel rollback --origin https://app.acme.com
```

## `zitadel schemas get SCHEMA`

Get one schema by id.

```
USAGE
  $ zitadel schemas get SCHEMA [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--fields <value>]

ARGUMENTS
  SCHEMA  object type (current revision) or revision id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is
                          unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one schema by id.

EXAMPLES
  $ zitadel schemas get <id>

  $ zitadel schemas get <id> --json
```

## `zitadel schemas list`

List schemas.

```
USAGE
  $ zitadel schemas list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--limit <value>] [-a | --page-token <value>] [--fields <value>] [--plain]
    [--filter <value>...]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive     Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>      Override the resolved server URL.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read the server and project from this file instead of the .env convention.
      --fields=<value>      Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the
                            resource's own columns; `--json` is unaffected.
      --filter=<value>...   Filter as field=operation:value (operation defaults to equals). Fields: object_type
                            (equals), kind (equals), revisions (equals; values all|latest).
      --limit=<value>       Page size (server default 20, max 100).
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.
      --[no-]telemetry      Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose             Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List schemas.

EXAMPLES
  $ zitadel schemas list --json

  $ zitadel schemas list --all --json

  $ zitadel schemas list --filter object_type=equals:<value>
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

## `zitadel sessions get ID`

Get one session by id.

```
USAGE
  $ zitadel sessions get ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--fields <value>]

ARGUMENTS
  ID  session id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is
                          unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

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
  $ zitadel sessions list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--limit <value>] [-a | --page-token <value>] [--fields <value>] [--plain]
    [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all
      Fetch every page instead of one.

  -c, --cwd=<value>
      Project directory to operate on.

  -e, --env=<value>
      Environment whose .env.<name>.local file binds the server and project.

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  --debug
      Debug logging.

  --dry-run
      Preview without mutating files or the platform.

  --env-file=<value>
      Read the server and project from this file instead of the .env convention.

  --fields=<value>
      Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the resource's own columns;
      `--json` is unaffected.

  --filter=<value>...
      Filter as field=operation:value (operation defaults to equals). Fields: created_at
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal), user_id
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal), state
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal),
      lifecycle_owner_team_id
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal).

  --limit=<value>
      Page size (server default 20, max 100).

  --page-token=<value>
      Continue from a previous page's next_page_token.

  --plain
      Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.

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
  $ zitadel sessions revoke ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [-f]

ARGUMENTS
  ID  session id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -f, --force             Revoke the session without the confirmation prompt. Required when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

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
  $ zitadel setup [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [-f] [--framework next|nuxt|react|vue|solid|svelte|qwik|angular] [--renderer
    react] [--dev-port <value>] [--skip-install] [--preset password-first|passkey-first] [--use-case
    minimal|consumer|business] [--sso google] [--sso-client-id <value>]

FLAGS
  -c, --cwd=<value>            Project directory to operate on.
  -e, --env=<value>            Environment whose .env.<name>.local file binds the server and project.
  -f, --force                  Overwrite managed files that already exist.
  -n, --non-interactive        Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>         Override the resolved server URL.
      --debug                  Debug logging.
      --dev-port=<value>       Dev-server port; also the issuer origin registered with Zitadel. Defaults to the detected
                               port. Use distinct ports to run several scaffolded apps side by side.
      --dry-run                Preview without mutating files or the platform.
      --env-file=<value>       Read the server and project from this file instead of the .env convention.
      --framework=<option>     Framework to target.
                               <options: next|nuxt|react|vue|solid|svelte|qwik|angular>
      --preset=<option>        Sign-in preset for the scaffolded schema and login flow (default: password-first).
                               <options: password-first|passkey-first>
      --renderer=<option>      Renderer (default: react). Not yet available: web-component.
                               <options: react>
      --skip-install           Do not install dependencies after setup updates package.json.
      --sso=<option>           Social sign-in provider to enable while scaffolding, e.g. google. Skips the wizard's
                               provider question; needs --sso-client-id, and the OAuth application must already be
                               registered with the provider. Pipe the client secret in on stdin; never pass it as a
                               flag.
                               <options: google>
      --sso-client-id=<value>  Client id of the OAuth application registered with the --sso provider.
      --[no-]telemetry         Send anonymous usage analytics. Disable with --no-telemetry.
      --use-case=<option>      Use case for the scaffolded schema fields: who signs in to the app (default: minimal).
                               <options: minimal|consumer|business>
      --verbose                Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Create a Zitadel project and scaffold local auth.

EXAMPLES
  $ zitadel setup --framework next

  $ zitadel setup --framework react --dev-port 3000
```

## `zitadel sso enable`

Enable an identity provider for a user schema.

```
USAGE
  $ zitadel sso enable [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--provider google] [--schema <value>] [--client-id <value>]

FLAGS
  -c, --cwd=<value>        Project directory to operate on.
  -e, --env=<value>        Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive    Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>     Override the resolved server URL.
      --client-id=<value>  Client id of the application registered with the provider.
      --debug              Debug logging.
      --dry-run            Preview without mutating files or the platform.
      --env-file=<value>   Read the server and project from this file instead of the .env convention.
      --provider=<option>  Identity provider to enable.
                           <options: google>
      --schema=<value>     User schema to change. Required when the Project has more than one.
      --[no-]telemetry     Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose            Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Enable an identity provider for a user schema.

EXAMPLES
  $ zitadel sso enable --provider google

  $ zitadel sso enable --provider google --schema customers

  $ zitadel sso enable --provider google --client-id 1234-abc.apps.googleusercontent.com --non-interactive < secret.txt
```

## `zitadel start`

Start a local Zitadel server.

```
USAGE
  $ zitadel start [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--image <value>] [--port <value>] [--runtime binary|docker]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
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
  $ zitadel status [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Summarize the local Zitadel server and project state.
```

## `zitadel stop`

Stop the local Zitadel server.

```
USAGE
  $ zitadel stop [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--all]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --all               Stop all discovered CLI-managed local Zitadel runtime processes.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Stop the local Zitadel server.
```

## `zitadel teams create`

Create a team.

```
USAGE
  $ zitadel teams create [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--name <value>] [--data <value> | --file <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

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

## `zitadel teams deactivate ID`

Deactivate a team by id.

```
USAGE
  $ zitadel teams deactivate ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [-f]

ARGUMENTS
  ID  team id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -f, --force             Deactivate the team without the confirmation prompt. Required when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Deactivate a team by id.

EXAMPLES
  $ zitadel teams deactivate <id> --force --json
```

## `zitadel teams get ID`

Get one team by id.

```
USAGE
  $ zitadel teams get ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--fields <value>]

ARGUMENTS
  ID  team id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is
                          unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

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
  $ zitadel teams list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--limit <value>] [-a | --page-token <value>] [--fields <value>] [--plain]
    [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive     Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>      Override the resolved server URL.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read the server and project from this file instead of the .env convention.
      --fields=<value>      Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the
                            resource's own columns; `--json` is unaffected.
      --filter=<value>...   Filter as field=operation:value (operation defaults to equals). Fields: created_at
                            (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_t
                            han_or_equal), name (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|gr
                            eater_than|greater_than_or_equal), status (equals|not_equals|contains|not_contains|less_than
                            |less_than_or_equal|greater_than|greater_than_or_equal).
      --limit=<value>       Page size (server default 20, max 100).
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.
      --sort=<value>        Sort as field:direction (asc|desc). Fields: created_at, name, status.
      --[no-]telemetry      Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose             Verbose logging.

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
  $ zitadel teams update ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--name <value>] [--data <value> | --file <value>]

ARGUMENTS
  ID  team id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

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
  $ zitadel uninstall [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [-f]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -f, --force             Remove the managed files without the confirmation prompt.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove managed files and local Zitadel state.

ALIASES
  $ zitadel uninstall
```

## `zitadel users create`

Create an user.

```
USAGE
  $ zitadel users create [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--schema <value>] [--attributes <value>...] [--data <value> | --file <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

REQUIRED FIELD FLAGS
  --attributes=<value>...  (required) Repeatable attributes entry: key=value for a string, key:=value for JSON. The
                           user's schema-defined content.
  --schema=<value>         (required) The schema that defines the content of `attributes`.

RAW BODY FLAGS
  --data=<value>  Whole body as a JSON object, instead of the field flags.
  --file=<value>  Read the body from a JSON file; `-` reads stdin.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Create an user.

EXAMPLES
  $ zitadel users create --schema <schema> --attributes <key>=<value> --json

  $ zitadel users create --data '{...}' --json

  $ zitadel users create --file ./user.json
```

## `zitadel users delete ID`

Delete an user by id.

```
USAGE
  $ zitadel users delete ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [-f]

ARGUMENTS
  ID  user id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -f, --force             Delete the user without the confirmation prompt. Required when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Delete an user by id.

EXAMPLES
  $ zitadel users delete <id> --force --json
```

## `zitadel users get ID`

Get one user by id.

```
USAGE
  $ zitadel users get ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--fields <value>]

ARGUMENTS
  ID  user id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to the resource's own; `--json` is
                          unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

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
  $ zitadel users list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--limit <value>] [-a | --page-token <value>] [--fields <value>] [--plain]
    [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all
      Fetch every page instead of one.

  -c, --cwd=<value>
      Project directory to operate on.

  -e, --env=<value>
      Environment whose .env.<name>.local file binds the server and project.

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  --debug
      Debug logging.

  --dry-run
      Preview without mutating files or the platform.

  --env-file=<value>
      Read the server and project from this file instead of the .env convention.

  --fields=<value>
      Columns to show, comma-separated dot-paths (e.g. id,attributes.email). Defaults to the resource's own columns;
      `--json` is unaffected.

  --filter=<value>...
      Filter as field=operation:value (operation defaults to equals). Fields: created_at
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal), id
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal), schema
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal), status
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal), team_id
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal),
      lifecycle_owner_team_id
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal).

  --limit=<value>
      Page size (server default 20, max 100).

  --page-token=<value>
      Continue from a previous page's next_page_token.

  --plain
      Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.

  --sort=<value>
      Sort as field:direction (asc|desc). Fields: created_at, id, schema, status, lifecycle_owner_team_id.

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

Update an user by id.

```
USAGE
  $ zitadel users update ID [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--schema <value>] [--attributes <value>...] [--data <value> | --file <value>]

ARGUMENTS
  ID  user id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

OPTIONAL FIELD FLAGS
  --attributes=<value>...  Repeatable attributes entry: key=value for a string, key:=value for JSON. The changed
                           attributes only.
  --schema=<value>         The schema the user follows after this patch.

RAW BODY FLAGS
  --data=<value>  Whole body as a JSON object, instead of the field flags.
  --file=<value>  Read the body from a JSON file; `-` reads stdin.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Update an user by id.

EXAMPLES
  $ zitadel users update <id> --data '{...}' --json

  $ zitadel users update <id> --file ./user.json
```

## `zitadel vars get NAME`

Get one variable from the project.

```
USAGE
  $ zitadel vars get NAME [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--preview]

ARGUMENTS
  NAME  Variable name to read.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --preview           Address the value previews get instead of the one every deploy gets.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one variable from the project.

EXAMPLES
  $ zitadel vars get GOOGLE_CLIENT_ID

  $ zitadel vars get GOOGLE_CLIENT_ID --preview --json
```

## `zitadel vars list`

List the project's variables and secrets.

```
USAGE
  $ zitadel vars list [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--preview] [--plain]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --plain             Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.
      --preview           Address the value previews get instead of the one every deploy gets.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List the project's variables and secrets.

EXAMPLES
  $ zitadel vars list

  $ zitadel vars list --json
```

## `zitadel vars resolve`

Show the variables a target is serving, frozen on its deployment.

```
USAGE
  $ zitadel vars resolve [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n] [--dry-run]
    [--verbose] [--debug] [--telemetry] [--preview] [--origin <value>] [--plain]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --origin=<value>    The target to read; omitted, the project default.
      --plain             Tab-separated rows with no header, for piping.
      --preview           Address the value previews get instead of the one every deploy gets.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Show the variables a target is serving, frozen on its deployment.

EXAMPLES
  $ zitadel vars resolve

  $ zitadel vars resolve --origin https://acme-git-sso-acmeinc.vercel.app
```

## `zitadel vars rm NAME`

Remove one variable from the project.

```
USAGE
  $ zitadel vars rm NAME [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--preview] [-f]

ARGUMENTS
  NAME  Variable name to remove.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -f, --force             Remove the variable without the confirmation prompt. Required when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --preview           Address the value previews get instead of the one every deploy gets.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove one variable from the project.

EXAMPLES
  $ zitadel vars rm GOOGLE_CLIENT_ID

  $ zitadel vars rm GOOGLE_CLIENT_SECRET --preview --force
```

## `zitadel vars set NAME`

Set one variable on the project.

```
USAGE
  $ zitadel vars set NAME [--json] [-c <value>] [-s <value>] [-e <value>] [--env-file <value>] [-n]
    [--dry-run] [--verbose] [--debug] [--telemetry] [--preview] [--secret] [--as string|number|boolean]

ARGUMENTS
  NAME  Variable name (letters, digits and underscores).

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment whose .env.<name>.local file binds the server and project.
  -n, --non-interactive   Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>    Override the resolved server URL.
      --as=<option>       [default: string] Store the value as this JSON type. A reference to the whole field resolves
                          to that type, so a number stays a number.
                          <options: string|number|boolean>
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read the server and project from this file instead of the .env convention.
      --preview           Address the value previews get instead of the one every deploy gets.
      --secret            Store the value encrypted. It can be replaced later but never read back.
      --[no-]telemetry    Send anonymous usage analytics. Disable with --no-telemetry.
      --verbose           Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Set one variable on the project.

EXAMPLES
  $ zitadel vars set GOOGLE_CLIENT_ID

  $ zitadel vars set GOOGLE_CLIENT_SECRET --secret < secret.txt

  $ zitadel vars set GOOGLE_CLIENT_SECRET --secret --preview

  $ zitadel vars set SESSION_TTL --as number
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
