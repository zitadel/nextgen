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

The detailed resource-command conventions are defined in [CLI Resource Commands](resource-commands.md) and [ADR 062](../../adrs/062-cli-resource-commands.md).

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

ZITADEL CLI
Build and manage authentication and identity.

Getting started
  setup              Set up a Project
  doctor             Check the local setup
  claim              Claim a Project

Local development
  start              Start ZITADEL locally
  stop               Stop local ZITADEL
  logs               Show local logs
  reset              Reset the local runtime
  eject              Remove generated files and local state

Configuration
  plan               Preview configuration changes
  apply              Apply configuration changes
  status             Show local and Project status
  schemas            Inspect user schemas
  branding           Customise login branding

Utilities
  autocomplete       Configure shell completion
  commands           List available commands
  help               Show command help
  search             Search for a command
  version            Show the CLI version
  which              Show where a command comes from
```

`plan` and `apply` are included because they are currently available, but they are transitional and will be replaced by the environment and release workflow.

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

Read-only and diagnostic commands return their result directly without prompting:

```text
list
get
status
doctor
events
resources
```

All commands must support automation. When required input is missing in non-interactive mode, the CLI returns a clear validation error rather than prompting.

Structured output such as `--json` never opens an interactive prompt.

## Guidance and feedback

Commands should:

- use sensible defaults, communicate the context being used and validate input before acting;
- show progress where useful and clearly communicate the outcome;
- provide actionable next steps, including how to recover from errors, and warn before destructive changes.

Guidance is shown only when it helps the user complete or recover from the current command. It must not interfere with structured output or require agents and automation to parse human-readable text.

## Detailed designs

- [CLI Resource Commands](resource-commands.md) — CRUD structure, filtering, pagination, output and agent contracts
- [ADR 062: CLI Resource Commands](../../adrs/062-cli-resource-commands.md) — decisions behind the resource-command surface
- [ADR 035: Environment Releases for Configuration Resources](../../adrs/035-configuration-environments.md) — environments, releases, deployments, promotion and rollback
- [CLI source](../../../apps/cli)
- [CLI agent guidance](../../../apps/cli/SKILLS.md)
