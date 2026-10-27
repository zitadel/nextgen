# CLI Design

> **Status:** Draft
> **Purpose:** Define the overall structure, discovery and interaction model for the ZITADEL CLI. Detailed conventions for individual command areas live in linked documents.

## Principles

The CLI is the common execution surface for developers, agents and automation.

It is:

- **Command-driven:** users can run a specific operation without completing a guided workflow.
- **Consistent:** similar resources and actions follow the same structure and vocabulary.
- **Discoverable:** commands are grouped clearly and each level provides useful help.
- **Automation-friendly:** commands can be executed through explicit arguments with predictable structured output.
- **Helpful where it matters:** defaults, validation, optional prompts and next steps reduce unnecessary work.
- **Safe:** destructive and security-sensitive actions clearly communicate their impact.

Higher-level experiences such as SDKs, embedded interfaces, agents and customer-facing administration UIs can use the same underlying capabilities.

## Command structure

The CLI supports three command shapes.

### Workflows

A workflow completes a broader user goal and may coordinate several resources:

```text
zitadel <workflow>
```

Examples:

```bash
zitadel setup
zitadel claim
zitadel deploy
zitadel promote
```

### Resource commands

A resource command performs a direct operation on a resource:

```text
zitadel <resource> <verb> [id] [flags]
```

Resource names are plural:

```bash
zitadel users create
zitadel teams list
zitadel projects get <id>
```

Resource commands use a consistent set of CRUD verbs where their meaning matches:

```text
create
list
get
update
delete
```

Meaningful IAM lifecycle actions can use explicit verbs when they communicate something different from standard CRUD:

```bash
zitadel sessions revoke <id>
zitadel sso connections activate <id>
```

Which resources and operations are available is defined by their relevant product and resource ADRs.

### Capability commands

A capability may contain its own actions or child resources:

```text
zitadel <capability> <action>
zitadel <capability> <resource> <verb>
```

For example:

```bash
zitadel sso enable
zitadel sso connections create
zitadel sso connections test <id>
```

Commands should not exceed three levels after `zitadel`.

Context and configuration values should be expressed as flags rather than additional command levels:

```bash
zitadel sso connections create --type saml
zitadel deploy --env production
```

## Top-level discovery

Running `zitadel` displays the available commands grouped by product area.

The headings are visual navigation only. They do not form part of the command syntax.

The example below shows how the commands currently available can be organised. It describes the grouping structure rather than fixing the CLI to this exact set of commands. As new commands are introduced, they should be added to the relevant product area—or a new product area where necessary—without changing their command syntax.

```console
$ zitadel

Manage your Zitadel project and local identity server from the command line.

Usage
  zitadel <command> [flags]

Run a command below. Use `zitadel <command> --help` to see its options.

Getting started
  setup             Create a Zitadel project and scaffold local auth
  start             Start a local Zitadel server
  status            Summarize the local Zitadel server and project state
  claim             Claim this project to make it permanent

Local development
  console           Open the local console, signed in as the local admin
  logs              Show local Zitadel server logs
  stop              Stop the local Zitadel server
  reset             Delete the local Zitadel server runtime and data
  eject             Remove managed files and local Zitadel state

Users and teams
  users             Create and manage users
  teams             Create and manage teams
  grants            Manage access grants

Authentication
  auth-method       Configure how users sign in
  idps              Manage identity provider connections
  sessions          View and revoke sessions

Configuration and releases
  deploy            Apply your local configuration to Zitadel
  pull              Rebuild your .zitadel/ files from a release
  branding          Manage the login branding
  deployment        Deploy releases and roll them back
  env               Show and bind environments
  flow-definitions  View login flows
  origin            Manage the project's allowed origins
  policies          View policies
  projects          View and update projects
  release           Build and manage releases
  schemas           View user schemas
  variable          Manage project variables

Diagnostics and utilities
  doctor            Verify local runtime and project state
  api               Call any operation of the Zitadel API
  autocomplete      Display autocomplete installation instructions
  commands          List all zitadel commands
  events            View events
  resources         List the resources this CLI manages
  search            Search for a command
  version           Show the CLI version
  which             Show which plugin a command is in

Flags
  --help      Show help for command
  --version   Show zitadel version

Examples
  $ zitadel setup --framework next
  $ zitadel start
  $ zitadel doctor
```

A family of commands is one row, so the screen stays short as commands are added; its own help (`zitadel users --help`) lists the operations. `zitadel commands` remains the flat list of every command.

Each level provides help for the commands available beneath it:

```bash
zitadel --help
zitadel schemas --help
zitadel schemas list --help
```

## Interaction model

The CLI uses three levels of interaction.

### Guided workflows

Guided interaction is reserved for infrequent workflows that require human authentication, consent or several important initial choices.

The currently identified guided workflows are:

```text
setup
claim
```

`setup` may guide the user through creating a Project and establishing its initial local configuration.

`claim` requires a person to authenticate and confirm ownership of a Project.

These are deliberate exceptions rather than the default CLI experience.

### Command-driven with optional interaction

Most commands run immediately when sufficient input is provided. In an interactive terminal, they may ask for a missing required choice, destructive confirmation or a browser-based action.

Examples include:

```text
deploy
promote
rollback
reset
eject
<resource> delete
sso connections create
sso connections test
```

For example, `deploy` may ask the user to select an environment if none was provided:

```bash
zitadel deploy
```

The same command can run non-interactively by providing the environment explicitly:

```bash
zitadel deploy --env production
```

Optional interaction should only help complete the requested command. It should not turn a flexible, non-linear IAM workflow into a terminal wizard.

### Non-interactive commands

Read-only and diagnostic commands do not require prompts in non-interactive mode; interactive commands may still offer optional selection:

```text
list
get
status
doctor
events
resources
```

All commands must support automation. `--no-input` suppresses all prompts, and structured output such as `--json` never opens a prompt. If required input is missing, the CLI returns a clear validation error.

## Guidance and feedback

Commands should:

- use sensible defaults, communicate the context being used and validate input before acting;
- show progress where useful and clearly communicate the outcome;
- provide actionable next steps, including how to recover from errors;
- match confirmation to the impact of an action: routine changes need no confirmation, destructive actions ask before proceeding in an interactive terminal, and especially consequential actions require explicit confirmation of the target. In non-interactive use, commands require an explicit flag for destructive actions instead of prompting.

Guidance is shown only when it helps the user complete or recover from the current command. It must not interfere with structured output or require agents and automation to parse human-readable text.

## Detailed designs

- [ADR 035: Environment Releases for Configuration Resources](../../adrs/035-configuration-environments.md) — environments, releases, deployments, promotion and rollback
- [Flow Engine](../flowengine/flow-engine.md)
- [Flow Engine — Developer Guide](../flowengine/flow-engine-guide.md)
- [Flow Engine — Step Response Shape](../flowengine/flow-engine-nodes.md) — capability dicts + Liquid templates + `text_key` localization
- [Template Security](../flowengine/template-security.md) — invariants the CLI validates on `apply`
- [User Schema Integration](../flowengine/user-schema.md)
- [Resource Commands](resource-commands.md) — the imperative `users` / `teams` / `sessions` / `events` / `grants` / `projects` surface and its conventions
- [CLI source](../../../apps/cli)
- [CLI agent guidance](../../../apps/cli/skills/zitadel-cli/SKILL.md)
