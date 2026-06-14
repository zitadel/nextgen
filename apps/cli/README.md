# @zitadel/cli

Scaffolds Zitadel auth (login, register, profile, middleware) into a Next.js, React, Vue, Angular, or Nuxt app.

```sh
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --server local
```

During the public alpha, bare `npx @zitadel/cli` resolves to the same tested
alpha CLI. Use `@alpha` or an exact `0.1.0-alpha.N` selector in bug reports and
automation when reproducibility matters.

> **Beta.** This is the **next-generation Zitadel**, a ground-up rewrite of the platform. It is distinct from the established Zitadel at [github.com/zitadel/zitadel](https://github.com/zitadel/zitadel). APIs and CLI flags will change.

## Requirements

- Node 20+
- Docker for the managed local Zitadel runtime
- A Next.js project, or an empty directory where setup can scaffold one

## Quickstart

```sh
mkdir my-app
cd my-app
npx @zitadel/cli@alpha doctor
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --server local
npm run dev
```

`start` runs a Docker-backed local Zitadel server and stores runtime data
under `.zitadel/local/`. Alpha CLI versions use the matching
`ghcr.io/zitadel/nextgen:<cli-version>` image by default; local/dev builds fall
back to `ghcr.io/zitadel/nextgen:latest`. Override with `--image` or
`ZITADEL_LOCAL_IMAGE` for advanced debugging.
`setup --server local` creates a project on that local server, asks which
framework to scaffold when the directory is fresh, writes the Next.js app into
the current directory, scaffolds `app/login`, `app/register`, and `proxy.ts`
for Next 16+ or `middleware.ts` for older Next versions, writes `.env.local`
and `.zitadel/`, and installs dependencies with the detected package manager.
Pass `--skip-install` to install them yourself. The project's default user
schema and login flow are provisioned server-side at creation time, so the CLI
does not scaffold or upload them. Open `http://localhost:3000/login` to see the
login page.

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

## Other commands

- `zitadel doctor` — verify the local Docker runtime and generated project files
- `zitadel status` — summarise the local Docker runtime and project
- `zitadel plan` — validate config and preview sync changes without mutation
- `zitadel apply` — validate and upload repo config to Zitadel
- `zitadel eject` — remove what setup wrote (alias: `zitadel uninstall`)
- `zitadel start|stop|logs|reset` — manage the local Docker runtime

## Reference

<details>
<summary>Full command reference</summary>

<!-- commands -->
* [`zitadel apply`](#zitadel-apply)
* [`zitadel autocomplete [SHELL]`](#zitadel-autocomplete-shell)
* [`zitadel commands`](#zitadel-commands)
* [`zitadel doctor`](#zitadel-doctor)
* [`zitadel eject`](#zitadel-eject)
* [`zitadel help [COMMAND]`](#zitadel-help-command)
* [`zitadel logs`](#zitadel-logs)
* [`zitadel plan`](#zitadel-plan)
* [`zitadel reset`](#zitadel-reset)
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
  $ zitadel apply [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug] [-e
    development|preview|production]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -f, --force                 Overwrite protected files on conflict.
  -n, --non-interactive       Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
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
  $ zitadel doctor [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug] [--fix]
    [--image <value>] [--port <value>]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --fix              Re-apply missing managed files.
      --image=<value>    Container image to check.
      --port=<value>     [default: 8080] Local HTTP port.
      --verbose          Verbose logging.

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

## `zitadel logs`

Show local Zitadel server logs.

```
USAGE
  $ zitadel logs [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug] [--follow]
    [--tail <value>]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --follow           Follow logs.
      --tail=<value>     [default: 200] Number of lines to show.
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
  $ zitadel plan [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug] [-e
    development|preview|production]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --environment=<option>  Target environment (default: development).
                              <options: development|preview|production>
  -f, --force                 Overwrite protected files on conflict.
  -n, --non-interactive       Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
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
  Delete the local Zitadel server runtime and data.
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
    [--framework next|nuxt|react|vue|angular] [--renderer react|web-component] [--dev-port <value>] [--skip-install]

FLAGS
  -c, --cwd=<value>         Project directory to operate on.
  -f, --force               Overwrite protected files on conflict.
  -n, --non-interactive     Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>      Override the resolved server URL.
      --debug               Debug logging.
      --dev-port=<value>    Dev-server port; also the issuer origin registered with Zitadel. Defaults to the detected
                            port. Use distinct ports to run several scaffolded apps side by side.
      --dry-run             Preview without mutating files or the platform.
      --framework=<option>  Framework to target.
                            <options: next|nuxt|react|vue|angular>
      --renderer=<option>   Renderer (default: react).
                            <options: react|web-component>
      --skip-install        Do not install dependencies after setup updates package.json.
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
  $ zitadel start [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug] [--image
    <value>] [--port <value>]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite protected files on conflict.
  -n, --non-interactive  Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>   Override the resolved server URL.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --image=<value>    Container image to run.
      --port=<value>     [default: 8080] Local HTTP port.
      --verbose          Verbose logging.

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
  Summarize the local Zitadel server and project state.
```

## `zitadel stop`

Stop the local Zitadel server.

```
USAGE
  $ zitadel stop [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug]

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
  Stop the local Zitadel server.
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
