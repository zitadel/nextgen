# zitadel

Agent-friendly Zitadel CLI for the next generation Zitadel project.

```sh
npx zitadel@latest
```

## Status

The CLI is still pre-release. It supports the mock-backed golden path for Next.js
App Router projects, but it is not yet a complete live platform client.

V1 creates a local Zitadel setup with mock-backed login and registration
routes. Repo config is the source of truth: edit `zitadel.json` or
`.zitadel/**`, then run `zitadel plan` or `zitadel apply`.

## Golden path

```sh
npx zitadel@latest setup --framework next
npx zitadel@latest doctor
npx zitadel@latest plan
npx zitadel@latest apply
```

Agents should use the skill in `SKILLS.md` and call commands with
`--non-interactive --json`:

```sh
npx zitadel@latest --help
npx zitadel@latest <command> --non-interactive --json
```

## Commands

<!-- commands -->
* [`zitadel apply`](#zitadel-apply)
* [`zitadel autocomplete [SHELL]`](#zitadel-autocomplete-shell)
* [`zitadel commands`](#zitadel-commands)
* [`zitadel doctor`](#zitadel-doctor)
* [`zitadel eject`](#zitadel-eject)
* [`zitadel help [COMMAND]`](#zitadel-help-command)
* [`zitadel plan`](#zitadel-plan)
* [`zitadel search`](#zitadel-search)
* [`zitadel setup`](#zitadel-setup)
* [`zitadel status`](#zitadel-status)
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
    [--framework next] [--user-fields <value>] [--auth-method passkey|password] [--renderer react|web-component]
    [--no-apply]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -f, --force                 Overwrite protected files on conflict.
  -n, --non-interactive       Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>        Override the resolved server URL.
      --auth-method=<option>  Auth method (default: passkey).
                              <options: passkey|password>
      --debug                 Debug logging.
      --dry-run               Preview without mutating files or the platform.
      --framework=<option>    Framework to target.
                              <options: next>
      --no-apply              Skip the automatic apply at the end of setup.
      --renderer=<option>     Renderer (default: react).
                              <options: react|web-component>
      --user-fields=<value>   Comma-separated list of user fields.
      --verbose               Verbose logging.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Create a Zitadel project and scaffold local auth.

EXAMPLES
  $ zitadel setup --framework next --auth-method passkey
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

## Release readiness

Before npm publishing is enabled, the package still needs the CI smoke checks to
stay green, live API coverage to catch up with the mock contract, and the
changesets publishing workflow to be enabled with confirmed npm ownership and
tokens. CI package tarballs are review artifacts only.
