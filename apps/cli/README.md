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

Agents should use the generated contract in `AGENTS.md` and call commands with
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
* [`zitadel plugins`](#zitadel-plugins)
* [`zitadel plugins add PLUGIN`](#zitadel-plugins-add-plugin)
* [`zitadel plugins:inspect PLUGIN...`](#zitadel-pluginsinspect-plugin)
* [`zitadel plugins install PLUGIN`](#zitadel-plugins-install-plugin)
* [`zitadel plugins link PATH`](#zitadel-plugins-link-path)
* [`zitadel plugins remove [PLUGIN]`](#zitadel-plugins-remove-plugin)
* [`zitadel plugins reset`](#zitadel-plugins-reset)
* [`zitadel plugins uninstall [PLUGIN]`](#zitadel-plugins-uninstall-plugin)
* [`zitadel plugins unlink [PLUGIN]`](#zitadel-plugins-unlink-plugin)
* [`zitadel plugins update`](#zitadel-plugins-update)
* [`zitadel search`](#zitadel-search)
* [`zitadel setup`](#zitadel-setup)
* [`zitadel status`](#zitadel-status)
* [`zitadel uninstall`](#zitadel-uninstall)
* [`zitadel update [CHANNEL]`](#zitadel-update-channel)
* [`zitadel version`](#zitadel-version)
* [`zitadel which`](#zitadel-which)

## `zitadel apply`

Validate and upload repo config to the platform.

```
USAGE
  $ zitadel apply [--json] [-c <value>] [-s <value>] [-n] [-f] [--dry-run] [--verbose] [--debug] [-e
    <value>]

FLAGS
  -c, --cwd=<value>          Project directory to operate on.
  -e, --environment=<value>  Target environment (default: development).
  -f, --force                Overwrite protected files on conflict.
  -n, --non-interactive      Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>       Override the resolved server URL.
      --debug                Debug logging.
      --dry-run              Preview without mutating files or the platform.
      --json                 Emit the JSON envelope instead of pretty output.
      --verbose              Verbose logging.

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
      --json             Emit the JSON envelope instead of pretty output.
      --verbose          Verbose logging.

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
      --json             Emit the JSON envelope instead of pretty output.
      --verbose          Verbose logging.

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
    <value>]

FLAGS
  -c, --cwd=<value>          Project directory to operate on.
  -e, --environment=<value>  Target environment (default: development).
  -f, --force                Overwrite protected files on conflict.
  -n, --non-interactive      Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>       Override the resolved server URL.
      --debug                Debug logging.
      --dry-run              Preview without mutating files or the platform.
      --json                 Emit the JSON envelope instead of pretty output.
      --verbose              Verbose logging.

DESCRIPTION
  Validate config without mutation and preview the sync diff.
```

## `zitadel plugins`

List installed plugins.

```
USAGE
  $ zitadel plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ zitadel plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.69/src/commands/plugins/index.ts)_

## `zitadel plugins add PLUGIN`

Installs a plugin into zitadel.

```
USAGE
  $ zitadel plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into zitadel.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the ZITADEL_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the ZITADEL_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ zitadel plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ zitadel plugins add myplugin

  Install a plugin from a github url.

    $ zitadel plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ zitadel plugins add someuser/someplugin
```

## `zitadel plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ zitadel plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ zitadel plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.69/src/commands/plugins/inspect.ts)_

## `zitadel plugins install PLUGIN`

Installs a plugin into zitadel.

```
USAGE
  $ zitadel plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into zitadel.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the ZITADEL_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the ZITADEL_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ zitadel plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ zitadel plugins install myplugin

  Install a plugin from a github url.

    $ zitadel plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ zitadel plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.69/src/commands/plugins/install.ts)_

## `zitadel plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ zitadel plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ zitadel plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.69/src/commands/plugins/link.ts)_

## `zitadel plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ zitadel plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ zitadel plugins unlink
  $ zitadel plugins remove

EXAMPLES
  $ zitadel plugins remove myplugin
```

## `zitadel plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ zitadel plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.69/src/commands/plugins/reset.ts)_

## `zitadel plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ zitadel plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ zitadel plugins unlink
  $ zitadel plugins remove

EXAMPLES
  $ zitadel plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.69/src/commands/plugins/uninstall.ts)_

## `zitadel plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ zitadel plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ zitadel plugins unlink
  $ zitadel plugins remove

EXAMPLES
  $ zitadel plugins unlink myplugin
```

## `zitadel plugins update`

Update installed plugins.

```
USAGE
  $ zitadel plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.69/src/commands/plugins/update.ts)_

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
    [--framework <value>] [--user-fields <value>] [--auth-method <value>] [--renderer <value>] [--no-apply]

FLAGS
  -c, --cwd=<value>          Project directory to operate on.
  -f, --force                Overwrite protected files on conflict.
  -n, --non-interactive      Disable prompts. Required when scripting or running as an agent.
  -s, --server=<value>       Override the resolved server URL.
      --auth-method=<value>  Auth method: passkey (default) or password.
      --debug                Debug logging.
      --dry-run              Preview without mutating files or the platform.
      --framework=<value>    Framework to target (v1 supports "next").
      --json                 Emit the JSON envelope instead of pretty output.
      --no-apply             Skip the automatic apply at the end of setup.
      --renderer=<value>     Renderer: react (default) or web-component.
      --user-fields=<value>  Comma-separated list of user fields.
      --verbose              Verbose logging.

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
      --json             Emit the JSON envelope instead of pretty output.
      --verbose          Verbose logging.

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
      --json             Emit the JSON envelope instead of pretty output.
      --verbose          Verbose logging.

DESCRIPTION
  Remove managed files and local Zitadel state.

ALIASES
  $ zitadel uninstall
```

## `zitadel update [CHANNEL]`

update the zitadel CLI

```
USAGE
  $ zitadel update [CHANNEL] [--force |  | [-a | -v <value> | -i]] [-b ]

FLAGS
  -a, --available        See available versions.
  -b, --verbose          Show more details about the available versions.
  -i, --interactive      Interactively select version to install. This is ignored if a channel is provided.
  -v, --version=<value>  Install a specific version.
      --force            Force a re-download of the requested version.

DESCRIPTION
  update the zitadel CLI

EXAMPLES
  Update to the stable channel:

    $ zitadel update stable

  Update to a specific version:

    $ zitadel update --version 1.0.0

  Interactively select version:

    $ zitadel update --interactive

  See available versions:

    $ zitadel update --available
```

_See code: [@oclif/plugin-update](https://github.com/oclif/plugin-update/blob/4.7.43/src/commands/update.ts)_

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
