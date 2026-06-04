# @zitadel/cli

Scaffolds Zitadel auth (login, register, profile, middleware) into a Next.js app.

```sh
npx @zitadel/cli@latest setup --framework next --server <your-zitadel-server>
```

> **Beta.** This is the **next-generation Zitadel**, a ground-up rewrite of the platform. It is distinct from the established Zitadel at [github.com/zitadel/zitadel](https://github.com/zitadel/zitadel). APIs and CLI flags will change.

## Requirements

- Node 20+
- A Next.js project created with `create-next-app`
- A running next-generation Zitadel server to point at:
  - **Zitadel Cloud** — coming soon
  - **Self-hosted** — grab a binary from [github.com/zitadel/nextgen/releases](https://github.com/zitadel/nextgen/releases) and run it locally

## Quickstart

```sh
npx create-next-app@latest my-app
cd my-app
npx @zitadel/cli@latest setup --framework next --server http://localhost:8080
npm run dev
```

`setup` creates a project on the Zitadel server, scaffolds `app/login`, `app/register`, `app/profile`, and `middleware.ts`, and writes `.env.local` and `.zitadel/`. The project's default user schema and login flow are provisioned server-side at creation time, so the CLI does not scaffold or upload them. Open `http://localhost:3000/login` to see the login page.

## Other commands

- `zitadel doctor` — verify the generated files and local state
- `zitadel status` — summarise the local project
- `zitadel eject` — remove what setup wrote (alias: `zitadel uninstall`)

## Reference

<details>
<summary>Full command reference</summary>

<!-- commands -->
* [`zitadel autocomplete [SHELL]`](#zitadel-autocomplete-shell)
* [`zitadel commands`](#zitadel-commands)
* [`zitadel doctor`](#zitadel-doctor)
* [`zitadel eject`](#zitadel-eject)
* [`zitadel help [COMMAND]`](#zitadel-help-command)
* [`zitadel search`](#zitadel-search)
* [`zitadel setup`](#zitadel-setup)
* [`zitadel status`](#zitadel-status)
* [`zitadel uninstall`](#zitadel-uninstall)
* [`zitadel version`](#zitadel-version)
* [`zitadel which`](#zitadel-which)

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

Verify generated files and local state.

```
USAGE
  $ zitadel doctor [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug] [--fix]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --fix              Re-apply missing managed files.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Verify generated files and local state.
```

## `zitadel eject`

Remove managed files and local Zitadel state.

```
USAGE
  $ zitadel eject [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
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
    [--framework next] [--renderer react|web-component]

FLAGS
  -c, --cwd=<value>         Project directory to operate on.
  -f, --force               Overwrite protected files on conflict.
  -n, --non-interactive     Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>      Override the resolved server URL.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --framework=<option>  Framework to target.
                            <options: next>
      --renderer=<option>   Renderer (default: react).
                            <options: react|web-component>
      --verbose             Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Create a Zitadel project and scaffold local auth.

EXAMPLES
  $ zitadel setup --framework next
```

## `zitadel status`

Summarize the local project state.

```
USAGE
  $ zitadel status [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --verbose          Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Summarize the local project state.
```

## `zitadel uninstall`

Remove managed files and local Zitadel state.

```
USAGE
  $ zitadel uninstall [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
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
