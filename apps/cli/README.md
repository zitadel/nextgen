# @zitadel/cli

Scaffolds Zitadel auth (login, register, profile, middleware/proxy) into a Next.js, Nuxt, React, Vue, Angular, Solid, Svelte, or Qwik app.

```sh
npx @zitadel/cli@alpha start
npx @zitadel/cli@alpha setup --server local
```

Always pass `@alpha`: bare `npx @zitadel/cli` resolves npm's `latest` tag, which
still points at an early `0.0.0` build. Use an exact `1.0.0-alpha.N` selector in
bug reports and automation when reproducibility matters.

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
APIs, then seeds `.zitadel/state.json` with what it uploaded.
Open the dev server URL printed by your framework, register a user, log out,
log back in, and end on the signed-in profile page. That user is an end user
of your app. The management console is a separate sign-in: run
`zitadel console` for a fresh one-time link as the local admin.

For a reproducible tester report, use the exact alpha train from the GitHub
Release:

```sh
npx @zitadel/cli@1.0.0-alpha.N doctor
npx @zitadel/cli@1.0.0-alpha.N start
npx @zitadel/cli@1.0.0-alpha.N setup --server local
```

The default project flow supports password registration/login, passkey
registration/login, and optional passkey setup after password registration.
Users who skip passkey setup can still sign in with password; users who add a
passkey can sign in with either credential.

Repo config is authoritative: edit `zitadel.json`, `.zitadel/schemas/*.json`,
`.zitadel/flows/*.json`, or `.zitadel/branding/` (a `branding.json` descriptor
plus a `login.liquid` LiquidJS template), then re-run `zitadel deploy`.
Server-provisioned defaults remain a fallback for non-CLI
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
- `zitadel deploy`: build a release from `.zitadel/` and deploy it to the project
  (`--dry-run` validates and shows the diff without publishing)
- `zitadel branding eject`: scaffold an editable login template from a design
- `zitadel schemas list`: list the project's user schemas
- `zitadel variable set|get|list|rm`: manage the project's variables and secrets
  (`--preview` for a preview override); `zitadel variable resolve` shows what a
  target's live deployment runs
- `zitadel origin add|list|rm`: manage the origin patterns the project admits
  (`--kind primary|preview`)
- `zitadel eject`: remove what setup wrote (alias: `zitadel uninstall`)
- `zitadel start|stop|logs|reset`: manage the local runtime

The full agent-facing contract (JSON envelope, posture rules, claim flow,
doctor repair) is [`SKILL.md`](https://github.com/zitadel/nextgen/blob/main/apps/cli/skills/zitadel-cli/SKILL.md),
which ships in this package.

## Reference

<details>
<summary>Full command reference</summary>

<!-- commands -->
* [`zitadel auth-method passkey disable`](#zitadel-auth-method-passkey-disable)
* [`zitadel auth-method passkey enable`](#zitadel-auth-method-passkey-enable)
* [`zitadel auth-method password disable`](#zitadel-auth-method-password-disable)
* [`zitadel auth-method password enable`](#zitadel-auth-method-password-enable)
* [`zitadel auth-method sso disable`](#zitadel-auth-method-sso-disable)
* [`zitadel auth-method sso enable`](#zitadel-auth-method-sso-enable)
* [`zitadel autocomplete [SHELL]`](#zitadel-autocomplete-shell)
* [`zitadel branding eject`](#zitadel-branding-eject)
* [`zitadel branding get ID`](#zitadel-branding-get-id)
* [`zitadel branding list`](#zitadel-branding-list)
* [`zitadel claim`](#zitadel-claim)
* [`zitadel commands`](#zitadel-commands)
* [`zitadel console`](#zitadel-console)
* [`zitadel deploy`](#zitadel-deploy)
* [`zitadel deployment create`](#zitadel-deployment-create)
* [`zitadel deployment get DEPLOYMENT_ID`](#zitadel-deployment-get-deployment_id)
* [`zitadel deployment list`](#zitadel-deployment-list)
* [`zitadel deployment rollback [DEPLOYMENT_ID]`](#zitadel-deployment-rollback-deployment_id)
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
* [`zitadel origin add PATTERN`](#zitadel-origin-add-pattern)
* [`zitadel origin list`](#zitadel-origin-list)
* [`zitadel origin rm PATTERN`](#zitadel-origin-rm-pattern)
* [`zitadel preview`](#zitadel-preview)
* [`zitadel preview list`](#zitadel-preview-list)
* [`zitadel preview rm URL`](#zitadel-preview-rm-url)
* [`zitadel projects get ID`](#zitadel-projects-get-id)
* [`zitadel projects list`](#zitadel-projects-list)
* [`zitadel projects update ID`](#zitadel-projects-update-id)
* [`zitadel release create`](#zitadel-release-create)
* [`zitadel release get ID`](#zitadel-release-get-id)
* [`zitadel release list`](#zitadel-release-list)
* [`zitadel release revoke RELEASE_ID`](#zitadel-release-revoke-release_id)
* [`zitadel reset`](#zitadel-reset)
* [`zitadel resources`](#zitadel-resources)
* [`zitadel schemas get SCHEMA`](#zitadel-schemas-get-schema)
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
* [`zitadel variable get NAME`](#zitadel-variable-get-name)
* [`zitadel variable list`](#zitadel-variable-list)
* [`zitadel variable resolve`](#zitadel-variable-resolve)
* [`zitadel variable rm NAME`](#zitadel-variable-rm-name)
* [`zitadel variable set NAME [VALUE]`](#zitadel-variable-set-name-value)
* [`zitadel version`](#zitadel-version)
* [`zitadel which`](#zitadel-which)

## `zitadel auth-method passkey disable`

Disable passkey sign-in for a user schema.

```
USAGE
  $ zitadel auth-method passkey disable [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [--schema <value>] [-f]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Disable the schema's last way to sign in. Its users can
                         then only be managed through the API.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --schema=<value>   User schema to change. Required when the Project has
                         more than one.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Disable passkey sign-in for a user schema.

EXAMPLES
  $ zitadel auth-method passkey disable

  $ zitadel auth-method passkey disable --schema customers
```

## `zitadel auth-method passkey enable`

Enable passkey sign-in for a user schema.

```
USAGE
  $ zitadel auth-method passkey enable [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [--schema <value>]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --schema=<value>   User schema to change. Required when the Project has
                         more than one.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Enable passkey sign-in for a user schema.

EXAMPLES
  $ zitadel auth-method passkey enable

  $ zitadel auth-method passkey enable --schema customers
```

## `zitadel auth-method password disable`

Disable password sign-in for a user schema.

```
USAGE
  $ zitadel auth-method password disable [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [--schema <value>] [-f]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Disable the schema's last way to sign in. Its users can
                         then only be managed through the API.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --schema=<value>   User schema to change. Required when the Project has
                         more than one.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Disable password sign-in for a user schema.

EXAMPLES
  $ zitadel auth-method password disable

  $ zitadel auth-method password disable --schema customers
```

## `zitadel auth-method password enable`

Enable password sign-in for a user schema.

```
USAGE
  $ zitadel auth-method password enable [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [--schema <value>]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --schema=<value>   User schema to change. Required when the Project has
                         more than one.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Enable password sign-in for a user schema.

EXAMPLES
  $ zitadel auth-method password enable

  $ zitadel auth-method password enable --schema customers
```

## `zitadel auth-method sso disable`

Remove an identity provider from a user schema.

```
USAGE
  $ zitadel auth-method sso disable [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [--schema <value>]
    [--provider <value>] [-f]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -f, --force             Disable the schema's last way to sign in. Its users
                          can then only be managed through the API.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --provider=<value>  Identity provider to remove.
      --schema=<value>    User schema to change. Required when the Project has
                          more than one.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove an identity provider from a user schema.

EXAMPLES
  $ zitadel auth-method sso disable --provider google

  $ zitadel auth-method sso disable --provider google --schema customers
```

## `zitadel auth-method sso enable`

Add an identity provider to a user schema.

```
USAGE
  $ zitadel auth-method sso enable [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--schema <value>] [--provider google|custom] [--slug <value>]
    [--display-name <value>] [--issuer <value>] [--scopes <value>] [--client-id
    <value>]

FLAGS
  -c, --cwd=<value>           Project directory to operate on.
  -e, --env=<value>           Environment to run against, e.g. production.
                              Defaults to ZITADEL_ENV, then the hosting
                              platform's build (VERCEL_ENV, or Netlify's
                              CONTEXT), then development.
  -n, --non-interactive       Disable prompts. Required when scripting or
                              running as an agent.
  -s, --server=<value>        Override the resolved server URL.
  -v, --verbose               Verbose logging.
      --client-id=<value>     Client id of the application registered with the
                              provider.
      --[no-]color            Colorize human output. Disable with --no-color;
                              NO_COLOR and FORCE_COLOR are honored too.
      --debug                 Debug logging.
      --display-name=<value>  Name shown on the custom connection's sign-in
                              button.
      --dry-run               Preview without mutating files or the platform.
      --env-file=<value>      Read ZITADEL_* values from this file ahead of the
                              process environment. Cannot be combined with
                              --env.
      --issuer=<value>        Issuer URL of the custom provider. Its endpoints
                              are found by OIDC discovery.
      --provider=<option>     Identity provider to enable, or "custom" for any
                              other OpenID Connect provider.
                              <options: google|custom>
      --schema=<value>        User schema to change. Required when the Project
                              has more than one.
      --scopes=<value>        Scopes the custom connection requests, separated
                              by spaces or commas. Must include openid. Default:
                              openid profile email.
      --slug=<value>          Name of the custom connection. Schemas and flows
                              refer to it by this.
      --[no-]telemetry        Send anonymous usage analytics. Disable with
                              --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Add an identity provider to a user schema.

EXAMPLES
  $ zitadel auth-method sso enable --provider google

  $ zitadel auth-method sso enable --provider google --schema customers

  $ zitadel auth-method sso enable --provider google --client-id 1234-abc.apps.googleusercontent.com --non-interactive < secret.txt

  $ zitadel auth-method sso enable --provider custom --slug acme-sso --display-name 'Acme SSO' --issuer https://sso.acme.example

  $ zitadel auth-method sso enable --provider custom --slug acme-sso --display-name 'Acme SSO' --issuer https://sso.acme.example --scopes 'openid profile email groups' --client-id abc123 --non-interactive < secret.txt
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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-f] [--design <value>]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Overwrite an existing branding file.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --design=<value>   Design to start from: centered or minimal (default:
                         centered).
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Take ownership of the login template: scaffold .zitadel/branding/ from a
  shipped design.
```

## `zitadel branding get ID`

Get one branding revision by id.

```
USAGE
  $ zitadel branding get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--fields <value>]

ARGUMENTS
  ID  branding revision id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to
                          the resource's own; `--json` is unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
  $ zitadel branding list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--fields <value>] [--plain]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fields=<value>    Columns to show, comma-separated dot-paths (e.g.
                          id,attributes.email). Defaults to the resource's own
                          columns; `--json` is unaffected.
      --plain             Tab-separated rows with no header, for piping. Implied
                          when stdout is not a terminal.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
  $ zitadel claim [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--no-open] [--timeout <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --no-open           Print the link instead of opening a browser.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.
      --timeout=<value>   Seconds to wait for the browser step. Defaults to the
                          link's own expiry (10 minutes).

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

## `zitadel console`

Open the local console, signed in as the local admin created by `zitadel start`.

```
USAGE
  $ zitadel console [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [--no-open]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --no-open          Print the sign-in link instead of opening a browser.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Open the local console, signed in as the local admin created by `zitadel
  start`.

  Run it in the directory `zitadel start` ran in, or one inside it: the local
  admin is read from the nearest `.zitadel/local/` on the way up.

EXAMPLES
  $ zitadel console

  $ zitadel console --no-open
```

## `zitadel deploy`

Build a release from .zitadel/ and deploy it to the project.

```
USAGE
  $ zitadel deploy [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [-m <value>] [--origin <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -m, --message=<value>   A short summary of what this release changes.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --origin=<value>    Deploy to one primary origin instead of every primary
                          origin.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Build a release from .zitadel/ and deploy it to the project.

EXAMPLES
  $ zitadel deploy -m 'add phone_number to human-user'

  $ zitadel deploy --origin https://app.acme.com

  $ zitadel deploy --dry-run
```

## `zitadel deployment create`

Deploy an existing release to the project's origins.

```
USAGE
  $ zitadel deployment create --release <value> [--json] [-c <value>] [-s
    <value>] [-n] [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e
    <value>] [--env-file <value>] [--origin <value>] [-m <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -m, --message=<value>   A short summary of why this deploys.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --origin=<value>    Deploy to one primary origin instead of every primary
                          origin.
      --release=<value>   (required) The release id to deploy.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Deploy an existing release to the project's origins.

EXAMPLES
  $ zitadel deployment create --release rel_01KX3RG8A7F0N9WD3P2E4YM5C1

  $ zitadel deployment create --release rel_01KX3RG8A7F0N9WD3P2E4YM5C1 --origin https://app.acme.com
```

## `zitadel deployment get DEPLOYMENT_ID`

Read one deployment by id.

```
USAGE
  $ zitadel deployment get DEPLOYMENT_ID [--json] [-c <value>] [-s <value>]
    [-n] [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>]
    [--env-file <value>]

ARGUMENTS
  DEPLOYMENT_ID  The deployment to read.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Read one deployment by id.

EXAMPLES
  $ zitadel deployment get dep_01KX5N7C9D2E7F0N9WD3P2E4YM6
```

## `zitadel deployment list`

List the project's deployments, newest first.

```
USAGE
  $ zitadel deployment list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--origin <value>] [--live] [--limit <value>] [-a | --page-token
    <value>] [--plain]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment to run against, e.g. production.
                            Defaults to ZITADEL_ENV, then the hosting platform's
                            build (VERCEL_ENV, or Netlify's CONTEXT), then
                            development.
  -n, --non-interactive     Disable prompts. Required when scripting or running
                            as an agent.
  -s, --server=<value>      Override the resolved server URL.
  -v, --verbose             Verbose logging.
      --[no-]color          Colorize human output. Disable with --no-color;
                            NO_COLOR and FORCE_COLOR are honored too.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read ZITADEL_* values from this file ahead of the
                            process environment. Cannot be combined with --env.
      --limit=<value>       Page size (server default 20, max 100).
      --live                What each target serves now, not the full history.
      --origin=<value>      Only deployments that targeted this origin.
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping.
                            Implied when stdout is not a terminal.
      --[no-]telemetry      Send anonymous usage analytics. Disable with
                            --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List the project's deployments, newest first.

EXAMPLES
  $ zitadel deployment list

  $ zitadel deployment list --all

  $ zitadel deployment list --live

  $ zitadel deployment list --origin https://app.acme.com
```

## `zitadel deployment rollback [DEPLOYMENT_ID]`

Roll back to an earlier deployment.

```
USAGE
  $ zitadel deployment rollback [DEPLOYMENT_ID] [--json] [-c <value>] [-s
    <value>] [-n] [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e
    <value>] [--env-file <value>] [--origin <value>] [-f]

ARGUMENTS
  [DEPLOYMENT_ID]  The deployment to re-apply. Omit to undo the last deploy.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -f, --force             Roll back without the confirmation prompt. Required
                          when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --origin=<value>    Which origin's history the bare form reads.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Roll back to an earlier deployment.

EXAMPLES
  $ zitadel deployment rollback

  $ zitadel deployment rollback dep_01KX5N7C9D2E7F0N9WD3P2E4YM6

  $ zitadel deployment rollback --origin https://app.acme.com --force
```

## `zitadel doctor`

Verify local runtime and project state.

```
USAGE
  $ zitadel doctor [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [--fix] [--image <value>]
    [--port <value>] [--runtime binary|docker] [-e <value>] [--env-file <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fix               Repair missing files and stale managed wiring.
      --image=<value>     Container image to check.
      --port=<value>      Local HTTP port to check. Defaults to the port this
                          directory's server uses.
      --runtime=<option>  Local runtime backend.
                          <options: binary|docker>
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-f]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Remove the managed files without the confirmation
                         prompt.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove managed files and local Zitadel state.

ALIASES
  $ zitadel uninstall
```

## `zitadel env`

Show which server and project resolve, and where each value came from.

```
USAGE
  $ zitadel env [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Show which server and project resolve, and where each value came from.

EXAMPLES
  $ zitadel env

  $ zitadel env --env production

  $ zitadel env --env-file ./infra/acme-staging.env
```

## `zitadel env add NAME`

Bind an environment to a project, creating the project if needed.

```
USAGE
  $ zitadel env add NAME [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [--project <value>]
    [--app-url <value>] [--force]

ARGUMENTS
  NAME  The environment name, e.g. production.

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --app-url=<value>  The URL this environment's app is served from. It
                         becomes ZITADEL_ISSUER and is registered with a new
                         project.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --force            Overwrite an existing .env.<name>.local.
      --project=<value>  Bind this existing project instead of creating one. Its
                         secrets come from ZITADEL_PROJECT_SECRET and
                         ZITADEL_PREVIEW_TOKEN in the process environment.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Bind an environment to a project, creating the project if needed.

EXAMPLES
  $ zitadel env add production --server https://api.zitadel.cloud --app-url https://app.acme.com

  $ zitadel env add staging --server https://api.zitadel.cloud --project proj_01K9AA9M3K7E2QX8VB4T
```

## `zitadel env list`

List the environments bound in this directory's .env files.

```
USAGE
  $ zitadel env list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--plain]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --plain             Tab-separated rows with no header, for piping. Implied
                          when stdout is not a terminal.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List the environments bound in this directory's .env files.

EXAMPLES
  $ zitadel env list

  $ zitadel env list --plain
```

## `zitadel events get ID`

Get one event by id.

```
USAGE
  $ zitadel events get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--fields <value>]

ARGUMENTS
  ID  event id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to
                          the resource's own; `--json` is unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--limit <value>] [-a | --page-token <value>] [--fields <value>]
    [--plain] [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all
      Fetch every page instead of one.

  -c, --cwd=<value>
      Project directory to operate on.

  -e, --env=<value>
      Environment to run against, e.g. production. Defaults to ZITADEL_ENV, then
      the hosting platform's build (VERCEL_ENV, or Netlify's CONTEXT), then
      development.

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  -v, --verbose
      Verbose logging.

  --[no-]color
      Colorize human output. Disable with --no-color; NO_COLOR and FORCE_COLOR are
      honored too.

  --debug
      Debug logging.

  --dry-run
      Preview without mutating files or the platform.

  --env-file=<value>
      Read ZITADEL_* values from this file ahead of the process environment.
      Cannot be combined with --env.

  --fields=<value>
      Columns to show, comma-separated dot-paths (e.g. id,attributes.email).
      Defaults to the resource's own columns; `--json` is unaffected.

  --filter=<value>...
      Filter as field=operation:value (operation defaults to equals). Fields:
      category (equals; values request|auth|session|admin|entity|signal; repeats
      widen), event_type (equals; repeats widen), actor_id (equals), session_id
      (equals), flow_id (equals), request_id (equals), entity_type (equals),
      entity_id (equals), team_id (equals), created_at
      (greater_than_or_equal|less_than).

  --limit=<value>
      Page size (server default 20, max 100).

  --page-token=<value>
      Continue from a previous page's next_page_token.

  --plain
      Tab-separated rows with no header, for piping. Implied when stdout is not a
      terminal.

  --sort=<value>
      Sort as field:direction (asc|desc). Fields: occurred_at.

  --[no-]telemetry
      Send anonymous usage analytics. Disable with --no-telemetry.

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
  $ zitadel flow-definitions get FLOW [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--fields <value>]

ARGUMENTS
  FLOW  flow name (newest revision) or revision id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to
                          the resource's own; `--json` is unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
  $ zitadel flow-definitions list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--limit <value>] [-a | --page-token <value>] [--fields <value>]
    [--plain] [--filter <value>...]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment to run against, e.g. production.
                            Defaults to ZITADEL_ENV, then the hosting platform's
                            build (VERCEL_ENV, or Netlify's CONTEXT), then
                            development.
  -n, --non-interactive     Disable prompts. Required when scripting or running
                            as an agent.
  -s, --server=<value>      Override the resolved server URL.
  -v, --verbose             Verbose logging.
      --[no-]color          Colorize human output. Disable with --no-color;
                            NO_COLOR and FORCE_COLOR are honored too.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read ZITADEL_* values from this file ahead of the
                            process environment. Cannot be combined with --env.
      --fields=<value>      Columns to show, comma-separated dot-paths (e.g.
                            id,attributes.email). Defaults to the resource's own
                            columns; `--json` is unaffected.
      --filter=<value>...   Filter as field=operation:value (operation defaults
                            to equals). Fields: name (equals), purpose (equals),
                            revisions (equals; values all|latest).
      --limit=<value>       Page size (server default 20, max 100).
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping.
                            Implied when stdout is not a terminal.
      --[no-]telemetry      Send anonymous usage analytics. Disable with
                            --no-telemetry.

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
  $ zitadel grants create [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--relation viewer|editor|admin] [--expires-at <value>]
    [--user-user-id <value>] [--user-identifier <value>] [--team-team-id
    <value>] [--team-name <value>] [--data <value> | --file <value>] [--set
    <value>...]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

RAW BODY FLAGS
  --data=<value>    Whole body as a JSON object. Field flags and --set apply
                    over it.
  --file=<value>    Read the body from a JSON file; `-` reads stdin. Field flags
                    and --set apply over it.
  --set=<value>...  Set one field by its dot path: path=value, or path:=json for
                    JSON. Repeatable; applied after the field flags, in order. A
                    key that contains a dot is set through its parent: --set
                    'parent:={"a.b":"x"}'.

OPTIONAL FIELD FLAGS
  --expires-at=<value>  Optional expiry.

GLOBAL FLAGS
  --json  Format output as json.

REQUIRED FIELD FLAGS
  --relation=<option>  (required) Catalog relation on `object_type` `project`.
                       <options: viewer|editor|admin>

TEAM FIELD FLAGS
  --team-name=<value>     Team name, unique per project case-insensitively.
  --team-team-id=<value>

USER FIELD FLAGS
  --user-identifier=<value>  The user schema's designated identifier
                             (`x-identifier`), looked up in the platform
                             project.
  --user-user-id=<value>

DESCRIPTION
  Create a grant.

EXAMPLES
  $ zitadel grants create --relation viewer --user-identifier alice@acme.com --json

  $ zitadel grants create --data '{...}' --json

  $ zitadel grants create --file ./grant.json
```

## `zitadel grants delete ID`

Delete a grant by id.

```
USAGE
  $ zitadel grants delete ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [-f]

ARGUMENTS
  ID  grant id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -f, --force             Delete the grant without the confirmation prompt.
                          Required when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--fields <value>]

ARGUMENTS
  ID  grant id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to
                          the resource's own; `--json` is unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--limit <value>] [-a | --page-token <value>] [--fields <value>]
    [--plain] [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all
      Fetch every page instead of one.

  -c, --cwd=<value>
      Project directory to operate on.

  -e, --env=<value>
      Environment to run against, e.g. production. Defaults to ZITADEL_ENV, then
      the hosting platform's build (VERCEL_ENV, or Netlify's CONTEXT), then
      development.

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  -v, --verbose
      Verbose logging.

  --[no-]color
      Colorize human output. Disable with --no-color; NO_COLOR and FORCE_COLOR are
      honored too.

  --debug
      Debug logging.

  --dry-run
      Preview without mutating files or the platform.

  --env-file=<value>
      Read ZITADEL_* values from this file ahead of the process environment.
      Cannot be combined with --env.

  --fields=<value>
      Columns to show, comma-separated dot-paths (e.g. id,attributes.email).
      Defaults to the resource's own columns; `--json` is unaffected.

  --filter=<value>...
      Filter as field=operation:value (operation defaults to equals). Fields:
      created_at (equals|not_equals|contains|not_contains|less_than|less_than_or_e
      qual|greater_than|greater_than_or_equal), user_id
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greate
      r_than|greater_than_or_equal), team_id (equals|not_equals|contains|not_conta
      ins|less_than|less_than_or_equal|greater_than|greater_than_or_equal),
      relation (equals|not_equals|contains|not_contains|less_than|less_than_or_equ
      al|greater_than|greater_than_or_equal), expires_at
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greate
      r_than|greater_than_or_equal).

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
  $ zitadel idps create [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--slug <value>] [--protocol oidc] [--template <value>]
    [--display-name <value>] [--subject-claim <value>] [--claim-mapping
    <value>...] [--verified-claims <value>...] [--provisioning-creation
    disabled|auto] [--oidc-issuer <value>] [--oidc-jwks-uri <value>]
    [--oidc-id-token-mapping] [--oidc-authorization-endpoint <value>]
    [--oidc-token-endpoint <value>] [--oidc-userinfo-endpoint <value>]
    [--oidc-client-id <value>] [--oidc-client-secret <value>]
    [--oidc-token-endpoint-auth-method client_secret_basic|client_secret_post]
    [--oidc-scopes <value>...] [--oidc-pkce-enabled]
    [--oidc-static-authorize-parameters <value>...] [--data <value> | --file
    <value>] [--set <value>...]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

OPTIONAL FIELD FLAGS
  --claim-mapping=<value>...    Repeatable claim_mapping entry: key=value for a
                                string, key:=value for JSON. Maps user-schema
                                property names (keys) to provider claim names
                                (values).
  --subject-claim=<value>       Claim carrying the provider's stable subject
                                identifier.
  --template=<value>            Template hint for rendering the provider (logo,
                                colors).
  --verified-claims=<value>...  Repeatable verified_claims entry: key=value for
                                a string, key:=value for JSON. Maps a verifiable
                                user-schema property to its verification source:
                                a claim name (read the claim) or the…

RAW BODY FLAGS
  --data=<value>    Whole body as a JSON object. Field flags and --set apply
                    over it.
  --file=<value>    Read the body from a JSON file; `-` reads stdin. Field flags
                    and --set apply over it.
  --set=<value>...  Set one field by its dot path: path=value, or path:=json for
                    JSON. Repeatable; applied after the field flags, in order. A
                    key that contains a dot is set through its parent: --set
                    'parent:={"a.b":"x"}'.

REQUIRED FIELD FLAGS
  --display-name=<value>  (required) Shown to the user on the sign-in button.
  --protocol=<option>     (required) The protocol used by the identity provider.
                          <options: oidc>
  --slug=<value>          (required) Stable identifier, referenced by user
                          schemas (x-auth-methods.sso.providers) and flow steps
                          (sso_providers).

GLOBAL FLAGS
  --json  Format output as json.

OIDC FIELD FLAGS
  --oidc-authorization-endpoint=<value>
      For a provider that exposes no .well-known document.

  --oidc-client-id=<value>
      (required with oidc.*) Either a literal in case the same client is used in
      all environments, or a `${{ NAME }}` reference to a…

  --oidc-client-secret=<value>
      (required with oidc.*) A reference to the variable holding the client
      secret, never the secret itself.

  --[no-]oidc-id-token-mapping
      Read user claims from the id_token instead of the userinfo endpoint, for
      providers that populate only the…

  --oidc-issuer=<value>
      (required with oidc.*) Discovery base.

  --oidc-jwks-uri=<value>
      JWKS endpoint, for a provider that exposes no .well-known document.

  --[no-]oidc-pkce-enabled
      Send PKCE (code_challenge/code_verifier).

  --oidc-scopes=<value>...
      Repeatable, one value each. Must contain `openid` - without it the provider
      returns no id_token and the connection is not OIDC.

  --oidc-static-authorize-parameters=<value>...
      Repeatable oidc.static_authorize_parameters entry: key=value for a string,
      key:=value for JSON. Extra provider-specific authorize parameters (for
      example `prompt`).

  --oidc-token-endpoint=<value>
      For a provider that exposes no .well-known document.

  --oidc-token-endpoint-auth-method=<option>
      How the client authenticates at the token endpoint.
      <options: client_secret_basic|client_secret_post>

  --oidc-userinfo-endpoint=<value>
      For a provider that exposes no .well-known document.

PROVISIONING FIELD FLAGS
  --provisioning-creation=<option>  <options: disabled|auto>

DESCRIPTION
  Create an identity provider connection.

EXAMPLES
  $ zitadel idps create --slug acme-sso --protocol oidc --display-name 'Acme SSO' --oidc-issuer https://sso.acme.example --oidc-client-id <client_id> --oidc-client-secret '${{ ACME_SSO_CLIENT_SECRET }}' --oidc-scopes openid --oidc-scopes profile --oidc-scopes email --json

  $ zitadel idps create --data '{...}' --json

  $ zitadel idps create --file ./identity-provider-connection.json
```

## `zitadel idps get ID`

Get one identity provider connection by id.

```
USAGE
  $ zitadel idps get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--fields <value>]

ARGUMENTS
  ID  identity provider connection id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to
                          the resource's own; `--json` is unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
  $ zitadel idps list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--limit <value>] [-a | --page-token <value>] [--fields <value>]
    [--plain] [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all
      Fetch every page instead of one.

  -c, --cwd=<value>
      Project directory to operate on.

  -e, --env=<value>
      Environment to run against, e.g. production. Defaults to ZITADEL_ENV, then
      the hosting platform's build (VERCEL_ENV, or Netlify's CONTEXT), then
      development.

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  -v, --verbose
      Verbose logging.

  --[no-]color
      Colorize human output. Disable with --no-color; NO_COLOR and FORCE_COLOR are
      honored too.

  --debug
      Debug logging.

  --dry-run
      Preview without mutating files or the platform.

  --env-file=<value>
      Read ZITADEL_* values from this file ahead of the process environment.
      Cannot be combined with --env.

  --fields=<value>
      Columns to show, comma-separated dot-paths (e.g. id,attributes.email).
      Defaults to the resource's own columns; `--json` is unaffected.

  --filter=<value>...
      Filter as field=operation:value (operation defaults to equals). Fields: slug
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greate
      r_than|greater_than_or_equal), created_at (equals|not_equals|contains|not_co
      ntains|less_than|less_than_or_equal|greater_than|greater_than_or_equal).

  --limit=<value>
      Page size (server default 20, max 100).

  --page-token=<value>
      Continue from a previous page's next_page_token.

  --plain
      Tab-separated rows with no header, for piping. Implied when stdout is not a
      terminal.

  --sort=<value>
      Sort as field:direction (asc|desc). Fields: slug, created_at.

  --[no-]telemetry
      Send anonymous usage analytics. Disable with --no-telemetry.

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
  $ zitadel logs [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [--follow] [--tail
    <value>]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --follow           Follow logs.
      --tail=<value>     [default: 200] Number of lines to show.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Show local Zitadel server logs.
```

## `zitadel origin add PATTERN`

Add an origin pattern to the project.

```
USAGE
  $ zitadel origin add PATTERN --kind primary|preview [--json] [-c
    <value>] [-s <value>] [-n] [--dry-run] [-v] [--debug] [--color]
    [--telemetry] [-e <value>] [--env-file <value>]

ARGUMENTS
  PATTERN  The origin pattern to add.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --kind=<option>     (required) What the pattern is for.
                          <options: primary|preview>
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Add an origin pattern to the project.

EXAMPLES
  $ zitadel origin add https://app.acme.com --kind primary

  $ zitadel origin add 'https://*-acme.vercel.app' --kind preview
```

## `zitadel origin list`

List the origin patterns on the project.

```
USAGE
  $ zitadel origin list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--plain]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --plain             Tab-separated rows with no header, for piping. Implied
                          when stdout is not a terminal.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List the origin patterns on the project.

EXAMPLES
  $ zitadel origin list

  $ zitadel origin list --plain
```

## `zitadel origin rm PATTERN`

Remove an origin pattern from the project.

```
USAGE
  $ zitadel origin rm PATTERN [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [-f]

ARGUMENTS
  PATTERN  The origin pattern to remove.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -f, --force             Remove the pattern without the confirmation prompt.
                          Required when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove an origin pattern from the project.

EXAMPLES
  $ zitadel origin rm https://app.acme.com

  $ zitadel origin rm https://app.acme.com --force
```

## `zitadel preview`

Deploy a release from .zitadel/ to a pull-request build's preview URLs.

```
USAGE
  $ zitadel preview [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--origin <value>...] [--ttl <value>] [--strict]

FLAGS
  -c, --cwd=<value>        Project directory to operate on.
  -e, --env=<value>        Environment to run against, e.g. production. Defaults
                           to ZITADEL_ENV, then the hosting platform's build
                           (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive    Disable prompts. Required when scripting or running
                           as an agent.
  -s, --server=<value>     Override the resolved server URL.
  -v, --verbose            Verbose logging.
      --[no-]color         Colorize human output. Disable with --no-color;
                           NO_COLOR and FORCE_COLOR are honored too.
      --debug              Debug logging.
      --dry-run            Preview without mutating files or the platform.
      --env-file=<value>   Read ZITADEL_* values from this file ahead of the
                           process environment. Cannot be combined with --env.
      --origin=<value>...  A preview URL to deploy to, instead of detecting them
                           from the platform build. Repeatable.
      --strict             Fail instead of warning when no preview credential
                           (ZITADEL_PREVIEW_TOKEN) is set.
      --[no-]telemetry     Send anonymous usage analytics. Disable with
                           --no-telemetry.
      --ttl=<value>        How long each preview stays live, e.g. 7d, 12h or
                           90m. Between 60s and 30d. Omitted, the project's
                           default applies.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Deploy a release from .zitadel/ to a pull-request build's preview URLs.

EXAMPLES
  $ zitadel preview

  $ zitadel preview --origin https://acme-git-sso-acmeinc.vercel.app

  $ zitadel preview --ttl 24h
```

## `zitadel preview list`

List the project's live previews, newest first.

```
USAGE
  $ zitadel preview list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--limit <value>] [-a | --page-token <value>] [--plain]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment to run against, e.g. production.
                            Defaults to ZITADEL_ENV, then the hosting platform's
                            build (VERCEL_ENV, or Netlify's CONTEXT), then
                            development.
  -n, --non-interactive     Disable prompts. Required when scripting or running
                            as an agent.
  -s, --server=<value>      Override the resolved server URL.
  -v, --verbose             Verbose logging.
      --[no-]color          Colorize human output. Disable with --no-color;
                            NO_COLOR and FORCE_COLOR are honored too.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read ZITADEL_* values from this file ahead of the
                            process environment. Cannot be combined with --env.
      --limit=<value>       Page size (server default 20, max 100).
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping.
                            Implied when stdout is not a terminal.
      --[no-]telemetry      Send anonymous usage analytics. Disable with
                            --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List the project's live previews, newest first.

EXAMPLES
  $ zitadel preview list

  $ zitadel preview list --all

  $ zitadel preview list --plain
```

## `zitadel preview rm URL`

Remove a live preview from the project.

```
USAGE
  $ zitadel preview rm URL [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [-f]

ARGUMENTS
  URL  The preview URL to remove.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -f, --force             Remove the preview without the confirmation prompt.
                          Required when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove a live preview from the project.

EXAMPLES
  $ zitadel preview rm https://acme-git-sso-acmeinc.vercel.app

  $ zitadel preview rm https://acme-git-sso-acmeinc.vercel.app --force
```

## `zitadel projects get ID`

Get one project by id.

```
USAGE
  $ zitadel projects get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--fields <value>]

ARGUMENTS
  ID  project id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to
                          the resource's own; `--json` is unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--limit <value>] [-a | --page-token <value>] [--fields <value>]
    [--plain] [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment to run against, e.g. production.
                            Defaults to ZITADEL_ENV, then the hosting platform's
                            build (VERCEL_ENV, or Netlify's CONTEXT), then
                            development.
  -n, --non-interactive     Disable prompts. Required when scripting or running
                            as an agent.
  -s, --server=<value>      Override the resolved server URL.
  -v, --verbose             Verbose logging.
      --[no-]color          Colorize human output. Disable with --no-color;
                            NO_COLOR and FORCE_COLOR are honored too.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read ZITADEL_* values from this file ahead of the
                            process environment. Cannot be combined with --env.
      --fields=<value>      Columns to show, comma-separated dot-paths (e.g.
                            id,attributes.email). Defaults to the resource's own
                            columns; `--json` is unaffected.
      --filter=<value>...   Filter as field=operation:value (operation defaults
                            to equals). Fields: created_at (equals|not_equals|co
                            ntains|not_contains|less_than|less_than_or_equal|gre
                            ater_than|greater_than_or_equal).
      --limit=<value>       Page size (server default 20, max 100).
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping.
                            Implied when stdout is not a terminal.
      --sort=<value>        Sort as field:direction (asc|desc). Fields:
                            created_at.
      --[no-]telemetry      Send anonymous usage analytics. Disable with
                            --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--name <value>] [--password-hash-algorithm
    argon2i|argon2id|bcrypt|scrypt|pbkdf2|sha2] [--password-hash-params-time
    <value>] [--password-hash-params-memory <value>]
    [--password-hash-params-threads <value>] [--password-hash-params-cost
    <value>] [--password-hash-params-rounds <value>]
    [--password-hash-params-hash sha1|sha224|sha256|sha384|sha512] [--data
    <value> | --file <value>] [--set <value>...]

ARGUMENTS
  ID  project id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

RAW BODY FLAGS
  --data=<value>    Whole body as a JSON object. Field flags and --set apply
                    over it.
  --file=<value>    Read the body from a JSON file; `-` reads stdin. Field flags
                    and --set apply over it.
  --set=<value>...  Set one field by its dot path: path=value, or path:=json for
                    JSON. Repeatable; applied after the field flags, in order. A
                    key that contains a dot is set through its parent: --set
                    'parent:={"a.b":"x"}'.

GLOBAL FLAGS
  --json  Format output as json.

OPTIONAL FIELD FLAGS
  --name=<value>  The name of the project.

PASSWORD HASH FIELD FLAGS
  --password-hash-algorithm=<option>      (required with password_hash.*) The
                                          hashing algorithm.
                                          <options: argon2i|argon2id|bcrypt|scry
                                          pt|pbkdf2|sha2>
  --password-hash-params-cost=<value>     bcrypt cost, or scrypt's log2 of the
                                          CPU/memory cost.
  --password-hash-params-hash=<option>    The underlying hash.
                                          <options:
                                          sha1|sha224|sha256|sha384|sha512>
  --password-hash-params-memory=<value>   argon2 memory in KiB.
  --password-hash-params-rounds=<value>   pbkdf2 or sha2 iteration count.
  --password-hash-params-threads=<value>  argon2 lanes.
  --password-hash-params-time=<value>     argon2 passes over memory.

DESCRIPTION
  Update a project by id.

EXAMPLES
  $ zitadel projects update <id> --data '{...}' --json

  $ zitadel projects update <id> --file ./project.json
```

## `zitadel release create`

Build a release from .zitadel/ without deploying it.

```
USAGE
  $ zitadel release create [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [-m <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -m, --message=<value>   A short summary of what this release changes.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Build a release from .zitadel/ without deploying it.

EXAMPLES
  $ zitadel release create

  $ zitadel release create -m 'add phone_number to human-user'
```

## `zitadel release get ID`

Get one release by id.

```
USAGE
  $ zitadel release get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--fields <value>]

ARGUMENTS
  ID  release id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to
                          the resource's own; `--json` is unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one release by id.

EXAMPLES
  $ zitadel release get <id>

  $ zitadel release get <id> --json
```

## `zitadel release list`

List release.

```
USAGE
  $ zitadel release list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--limit <value>] [-a | --page-token <value>] [--fields <value>]
    [--plain]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment to run against, e.g. production.
                            Defaults to ZITADEL_ENV, then the hosting platform's
                            build (VERCEL_ENV, or Netlify's CONTEXT), then
                            development.
  -n, --non-interactive     Disable prompts. Required when scripting or running
                            as an agent.
  -s, --server=<value>      Override the resolved server URL.
  -v, --verbose             Verbose logging.
      --[no-]color          Colorize human output. Disable with --no-color;
                            NO_COLOR and FORCE_COLOR are honored too.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read ZITADEL_* values from this file ahead of the
                            process environment. Cannot be combined with --env.
      --fields=<value>      Columns to show, comma-separated dot-paths (e.g.
                            id,attributes.email). Defaults to the resource's own
                            columns; `--json` is unaffected.
      --limit=<value>       Page size (server default 20, max 100).
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping.
                            Implied when stdout is not a terminal.
      --[no-]telemetry      Send anonymous usage analytics. Disable with
                            --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List release.

EXAMPLES
  $ zitadel release list --json

  $ zitadel release list --all --json
```

## `zitadel release revoke RELEASE_ID`

Revoke a release so its content is never served again.

```
USAGE
  $ zitadel release revoke RELEASE_ID [--json] [-c <value>] [-s <value>]
    [-n] [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>]
    [--env-file <value>] [-f]

ARGUMENTS
  RELEASE_ID  The release to revoke.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -f, --force             Revoke without the confirmation prompt. Required when
                          non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Revoke a release so its content is never served again.

EXAMPLES
  $ zitadel release revoke rel_01KX3RG8A7F0N9WD3P2E4YM5C1

  $ zitadel release revoke rel_01KX3RG8A7F0N9WD3P2E4YM5C1 --force
```

## `zitadel reset`

Delete the local Zitadel server runtime and data.

```
USAGE
  $ zitadel reset [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-f]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Delete the local runtime and its data without the
                         confirmation prompt.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [--plain]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --plain            Tab-separated rows with no header, for piping. Implied
                         when stdout is not a terminal.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List the resources this CLI manages and what can be done to each.

EXAMPLES
  $ zitadel resources

  $ zitadel resources --json

  $ zitadel resources --json | jq -r '.data.items[] | "\(.topic): \(.verbs | join(", "))"'
```

## `zitadel schemas get SCHEMA`

Get one schema by id.

```
USAGE
  $ zitadel schemas get SCHEMA [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--fields <value>]

ARGUMENTS
  SCHEMA  object type (current revision) or revision id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to
                          the resource's own; `--json` is unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
  $ zitadel schemas list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--limit <value>] [-a | --page-token <value>] [--fields <value>]
    [--plain] [--filter <value>...]

FLAGS
  -a, --all                 Fetch every page instead of one.
  -c, --cwd=<value>         Project directory to operate on.
  -e, --env=<value>         Environment to run against, e.g. production.
                            Defaults to ZITADEL_ENV, then the hosting platform's
                            build (VERCEL_ENV, or Netlify's CONTEXT), then
                            development.
  -n, --non-interactive     Disable prompts. Required when scripting or running
                            as an agent.
  -s, --server=<value>      Override the resolved server URL.
  -v, --verbose             Verbose logging.
      --[no-]color          Colorize human output. Disable with --no-color;
                            NO_COLOR and FORCE_COLOR are honored too.
      --debug               Debug logging.
      --dry-run             Preview without mutating files or the platform.
      --env-file=<value>    Read ZITADEL_* values from this file ahead of the
                            process environment. Cannot be combined with --env.
      --fields=<value>      Columns to show, comma-separated dot-paths (e.g.
                            id,attributes.email). Defaults to the resource's own
                            columns; `--json` is unaffected.
      --filter=<value>...   Filter as field=operation:value (operation defaults
                            to equals). Fields: object_type (equals), kind
                            (equals), revisions (equals; values all|latest).
      --limit=<value>       Page size (server default 20, max 100).
      --page-token=<value>  Continue from a previous page's next_page_token.
      --plain               Tab-separated rows with no header, for piping.
                            Implied when stdout is not a terminal.
      --[no-]telemetry      Send anonymous usage analytics. Disable with
                            --no-telemetry.

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

  Once you select a command, hit enter and it will show the help for that
  command.
```

_See code: [@oclif/plugin-search](https://github.com/oclif/plugin-search/blob/v1.2.50/src/commands/search.ts)_

## `zitadel sessions get ID`

Get one session by id.

```
USAGE
  $ zitadel sessions get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--fields <value>]

ARGUMENTS
  ID  session id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to
                          the resource's own; `--json` is unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--limit <value>] [-a | --page-token <value>] [--fields <value>]
    [--plain] [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all
      Fetch every page instead of one.

  -c, --cwd=<value>
      Project directory to operate on.

  -e, --env=<value>
      Environment to run against, e.g. production. Defaults to ZITADEL_ENV, then
      the hosting platform's build (VERCEL_ENV, or Netlify's CONTEXT), then
      development.

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  -v, --verbose
      Verbose logging.

  --[no-]color
      Colorize human output. Disable with --no-color; NO_COLOR and FORCE_COLOR are
      honored too.

  --debug
      Debug logging.

  --dry-run
      Preview without mutating files or the platform.

  --env-file=<value>
      Read ZITADEL_* values from this file ahead of the process environment.
      Cannot be combined with --env.

  --fields=<value>
      Columns to show, comma-separated dot-paths (e.g. id,attributes.email).
      Defaults to the resource's own columns; `--json` is unaffected.

  --filter=<value>...
      Filter as field=operation:value (operation defaults to equals). Fields:
      created_at (equals|not_equals|contains|not_contains|less_than|less_than_or_e
      qual|greater_than|greater_than_or_equal), user_id
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greate
      r_than|greater_than_or_equal), state (equals|not_equals|contains|not_contain
      s|less_than|less_than_or_equal|greater_than|greater_than_or_equal),
      lifecycle_owner_team_id (equals|not_equals|contains|not_contains|less_than|l
      ess_than_or_equal|greater_than|greater_than_or_equal).

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [-f]

ARGUMENTS
  ID  session id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -f, --force             Revoke the session without the confirmation prompt.
                          Required when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-f] [--framework
    next|nuxt|react|vue|solid|svelte|qwik|angular] [--renderer react]
    [--dev-port <value>] [--skip-install] [--preset
    password-first|passkey-first] [--use-case minimal|consumer|business] [--sso
    google|custom] [--sso-client-id <value>] [--sso-slug <value>]
    [--sso-display-name <value>] [--sso-issuer <value>] [--sso-scopes <value>]

FLAGS
  -c, --cwd=<value>
      Project directory to operate on.

  -f, --force
      Overwrite managed files that already exist, and scaffold into a non-empty
      directory.

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  -v, --verbose
      Verbose logging.

  --[no-]color
      Colorize human output. Disable with --no-color; NO_COLOR and FORCE_COLOR are
      honored too.

  --debug
      Debug logging.

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

  --sso=<option>
      Social sign-in provider to enable while scaffolding, e.g. google. Skips the
      wizard's provider question; needs --sso-client-id, and the OAuth application
      must already be registered with the provider. Pipe the client secret in on
      stdin; never pass it as a flag.
      <options: google|custom>

  --sso-client-id=<value>
      Client id of the OAuth application registered with the --sso provider.

  --sso-display-name=<value>
      With --sso custom: the name shown on the sign-in button.

  --sso-issuer=<value>
      With --sso custom: the provider's issuer URL. Its endpoints come from OIDC
      discovery.

  --sso-scopes=<value>
      With --sso custom: the scopes to request, separated by spaces or commas.
      Must include openid. Default: openid profile email.

  --sso-slug=<value>
      With --sso custom: the name of the connection. Schemas and flows refer to
      it.

  --[no-]telemetry
      Send anonymous usage analytics. Disable with --no-telemetry.

  --use-case=<option>
      Use case for the scaffolded schema fields: who signs in to the app (default:
      minimal).
      <options: minimal|consumer|business>

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [--image <value>] [--port
    <value>] [--runtime binary|docker]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --image=<value>     Container image to run.
      --port=<value>      Local HTTP port. By default this directory keeps the
                          port it had, or takes the first free one from 8080.
      --runtime=<option>  Local runtime backend.
                          <options: binary|docker>
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [--all]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --all              Stop all discovered CLI-managed local Zitadel runtime
                         processes.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--name <value>] [--data <value> | --file <value>] [--set
    <value>...]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

RAW BODY FLAGS
  --data=<value>    Whole body as a JSON object. Field flags and --set apply
                    over it.
  --file=<value>    Read the body from a JSON file; `-` reads stdin. Field flags
                    and --set apply over it.
  --set=<value>...  Set one field by its dot path: path=value, or path:=json for
                    JSON. Repeatable; applied after the field flags, in order. A
                    key that contains a dot is set through its parent: --set
                    'parent:={"a.b":"x"}'.

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
  $ zitadel teams deactivate ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [-f]

ARGUMENTS
  ID  team id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -f, --force             Deactivate the team without the confirmation prompt.
                          Required when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
  $ zitadel teams get ID [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--fields <value>]

ARGUMENTS
  ID  team id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to
                          the resource's own; `--json` is unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--limit <value>] [-a | --page-token <value>] [--fields <value>]
    [--plain] [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all
      Fetch every page instead of one.

  -c, --cwd=<value>
      Project directory to operate on.

  -e, --env=<value>
      Environment to run against, e.g. production. Defaults to ZITADEL_ENV, then
      the hosting platform's build (VERCEL_ENV, or Netlify's CONTEXT), then
      development.

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  -v, --verbose
      Verbose logging.

  --[no-]color
      Colorize human output. Disable with --no-color; NO_COLOR and FORCE_COLOR are
      honored too.

  --debug
      Debug logging.

  --dry-run
      Preview without mutating files or the platform.

  --env-file=<value>
      Read ZITADEL_* values from this file ahead of the process environment.
      Cannot be combined with --env.

  --fields=<value>
      Columns to show, comma-separated dot-paths (e.g. id,attributes.email).
      Defaults to the resource's own columns; `--json` is unaffected.

  --filter=<value>...
      Filter as field=operation:value (operation defaults to equals). Fields:
      created_at (equals|not_equals|contains|not_contains|less_than|less_than_or_e
      qual|greater_than|greater_than_or_equal), name
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greate
      r_than|greater_than_or_equal), status (equals|not_equals|contains|not_contai
      ns|less_than|less_than_or_equal|greater_than|greater_than_or_equal).

  --limit=<value>
      Page size (server default 20, max 100).

  --page-token=<value>
      Continue from a previous page's next_page_token.

  --plain
      Tab-separated rows with no header, for piping. Implied when stdout is not a
      terminal.

  --sort=<value>
      Sort as field:direction (asc|desc). Fields: created_at, name, status.

  --[no-]telemetry
      Send anonymous usage analytics. Disable with --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--name <value>] [--data <value> | --file <value>] [--set
    <value>...]

ARGUMENTS
  ID  team id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

RAW BODY FLAGS
  --data=<value>    Whole body as a JSON object. Field flags and --set apply
                    over it.
  --file=<value>    Read the body from a JSON file; `-` reads stdin. Field flags
                    and --set apply over it.
  --set=<value>...  Set one field by its dot path: path=value, or path:=json for
                    JSON. Repeatable; applied after the field flags, in order. A
                    key that contains a dot is set through its parent: --set
                    'parent:={"a.b":"x"}'.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-f]

FLAGS
  -c, --cwd=<value>      Project directory to operate on.
  -f, --force            Remove the managed files without the confirmation
                         prompt.
  -n, --non-interactive  Disable prompts. Required when scripting or running as
                         an agent.
  -s, --server=<value>   Override the resolved server URL.
  -v, --verbose          Verbose logging.
      --[no-]color       Colorize human output. Disable with --no-color;
                         NO_COLOR and FORCE_COLOR are honored too.
      --debug            Debug logging.
      --dry-run          Preview without mutating files or the platform.
      --[no-]telemetry   Send anonymous usage analytics. Disable with
                         --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--schema <value>] [--attributes <value>...] [--data <value> |
    --file <value>] [--set <value>...]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

REQUIRED FIELD FLAGS
  --attributes=<value>...  (required) Repeatable attributes entry: key=value for
                           a string, key:=value for JSON. The user's
                           schema-defined content.
  --schema=<value>         (required) The schema that defines the content of
                           `attributes`.

RAW BODY FLAGS
  --data=<value>    Whole body as a JSON object. Field flags and --set apply
                    over it.
  --file=<value>    Read the body from a JSON file; `-` reads stdin. Field flags
                    and --set apply over it.
  --set=<value>...  Set one field by its dot path: path=value, or path:=json for
                    JSON. Repeatable; applied after the field flags, in order. A
                    key that contains a dot is set through its parent: --set
                    'parent:={"a.b":"x"}'.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [-f]

ARGUMENTS
  ID  user id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -f, --force             Delete the user without the confirmation prompt.
                          Required when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--fields <value>]

ARGUMENTS
  ID  user id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --fields=<value>    Fields to show, comma-separated dot-paths. Defaults to
                          the resource's own; `--json` is unaffected.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--limit <value>] [-a | --page-token <value>] [--fields <value>]
    [--plain] [--filter <value>...] [--sort <value>]

FLAGS
  -a, --all
      Fetch every page instead of one.

  -c, --cwd=<value>
      Project directory to operate on.

  -e, --env=<value>
      Environment to run against, e.g. production. Defaults to ZITADEL_ENV, then
      the hosting platform's build (VERCEL_ENV, or Netlify's CONTEXT), then
      development.

  -n, --non-interactive
      Disable prompts. Required when scripting or running as an agent.

  -s, --server=<value>
      Override the resolved server URL.

  -v, --verbose
      Verbose logging.

  --[no-]color
      Colorize human output. Disable with --no-color; NO_COLOR and FORCE_COLOR are
      honored too.

  --debug
      Debug logging.

  --dry-run
      Preview without mutating files or the platform.

  --env-file=<value>
      Read ZITADEL_* values from this file ahead of the process environment.
      Cannot be combined with --env.

  --fields=<value>
      Columns to show, comma-separated dot-paths (e.g. id,attributes.email).
      Defaults to the resource's own columns; `--json` is unaffected.

  --filter=<value>...
      Filter as field=operation:value (operation defaults to equals). Fields:
      created_at (equals|not_equals|contains|not_contains|less_than|less_than_or_e
      qual|greater_than|greater_than_or_equal), id (equals|not_equals|contains|not
      _contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal),
      schema (equals|not_equals|contains|not_contains|less_than|less_than_or_equal
      |greater_than|greater_than_or_equal), status (equals|not_equals|contains|not
      _contains|less_than|less_than_or_equal|greater_than|greater_than_or_equal),
      team_id (equals|not_equals|contains|not_contains|less_than|less_than_or_equa
      l|greater_than|greater_than_or_equal), lifecycle_owner_team_id
      (equals|not_equals|contains|not_contains|less_than|less_than_or_equal|greate
      r_than|greater_than_or_equal).

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
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--schema <value>] [--attributes <value>...] [--data <value> |
    --file <value>] [--set <value>...]

ARGUMENTS
  ID  user id

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

OPTIONAL FIELD FLAGS
  --attributes=<value>...  Repeatable attributes entry: key=value for a string,
                           key:=value for JSON. The changed attributes only.
  --schema=<value>         The schema the user follows after this patch.

RAW BODY FLAGS
  --data=<value>    Whole body as a JSON object. Field flags and --set apply
                    over it.
  --file=<value>    Read the body from a JSON file; `-` reads stdin. Field flags
                    and --set apply over it.
  --set=<value>...  Set one field by its dot path: path=value, or path:=json for
                    JSON. Repeatable; applied after the field flags, in order. A
                    key that contains a dot is set through its parent: --set
                    'parent:={"a.b":"x"}'.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Update a user by id.

EXAMPLES
  $ zitadel users update <id> --data '{...}' --json

  $ zitadel users update <id> --file ./user.json
```

## `zitadel variable get NAME`

Get one variable from the project.

```
USAGE
  $ zitadel variable get NAME [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--preview]

ARGUMENTS
  NAME  Variable name to read.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --preview           Read the preview value instead of the primary one.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get one variable from the project.

EXAMPLES
  $ zitadel variable get GOOGLE_CLIENT_ID

  $ zitadel variable get API_URL --preview

  $ zitadel variable get GOOGLE_CLIENT_ID --json
```

## `zitadel variable list`

List the variables entered on the project.

```
USAGE
  $ zitadel variable list [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--preview] [--plain]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --plain             Tab-separated rows with no header, for piping. Implied
                          when stdout is not a terminal.
      --preview           List the preview values instead of the primary ones.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List the variables entered on the project.

EXAMPLES
  $ zitadel variable list

  $ zitadel variable list --preview

  $ zitadel variable list --json
```

## `zitadel variable resolve`

Show the variables the live deployment froze for a target.

```
USAGE
  $ zitadel variable resolve [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--origin <value>] [--plain]

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --origin=<value>    The origin whose live deployment to read.
      --plain             Tab-separated rows with no header, for piping. Implied
                          when stdout is not a terminal.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Show the variables the live deployment froze for a target.

EXAMPLES
  $ zitadel variable resolve

  $ zitadel variable resolve --origin https://app.acme.com

  $ zitadel variable resolve --json
```

## `zitadel variable rm NAME`

Remove one variable from the project.

```
USAGE
  $ zitadel variable rm NAME [--json] [-c <value>] [-s <value>] [-n]
    [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>] [--env-file
    <value>] [--preview] [-f]

ARGUMENTS
  NAME  Variable name to remove.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -f, --force             Remove the variable without the confirmation prompt.
                          Required when non-interactive.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --preview           Remove the preview value alone, leaving the primary
                          one standing.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Remove one variable from the project.

EXAMPLES
  $ zitadel variable rm GOOGLE_CLIENT_ID

  $ zitadel variable rm API_URL --preview

  $ zitadel variable rm GOOGLE_CLIENT_ID --force
```

## `zitadel variable set NAME [VALUE]`

Set one variable on the project.

```
USAGE
  $ zitadel variable set NAME [VALUE] [--json] [-c <value>] [-s <value>]
    [-n] [--dry-run] [-v] [--debug] [--color] [--telemetry] [-e <value>]
    [--env-file <value>] [--secret] [--as string|number|boolean] [--preview]

ARGUMENTS
  NAME     Variable name (letters, digits and underscores).
  [VALUE]  The value, for a plain (non-secret) variable.

FLAGS
  -c, --cwd=<value>       Project directory to operate on.
  -e, --env=<value>       Environment to run against, e.g. production. Defaults
                          to ZITADEL_ENV, then the hosting platform's build
                          (VERCEL_ENV, or Netlify's CONTEXT), then development.
  -n, --non-interactive   Disable prompts. Required when scripting or running as
                          an agent.
  -s, --server=<value>    Override the resolved server URL.
  -v, --verbose           Verbose logging.
      --as=<option>       [default: string] Store the value as this JSON type.
                          <options: string|number|boolean>
      --[no-]color        Colorize human output. Disable with --no-color;
                          NO_COLOR and FORCE_COLOR are honored too.
      --debug             Debug logging.
      --dry-run           Preview without mutating files or the platform.
      --env-file=<value>  Read ZITADEL_* values from this file ahead of the
                          process environment. Cannot be combined with --env.
      --preview           Write the preview value alone, leaving the primary one
                          as it is.
      --secret            Store the value encrypted. It can be replaced later
                          but never read back.
      --[no-]telemetry    Send anonymous usage analytics. Disable with
                          --no-telemetry.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Set one variable on the project.

EXAMPLES
  $ zitadel variable set GOOGLE_CLIENT_ID 1234.apps.googleusercontent.com

  $ zitadel variable set GOOGLE_CLIENT_SECRET --secret < secret.txt

  $ zitadel variable set SESSION_TTL 3600 --as number

  $ zitadel variable set API_URL https://preview.acme.com --preview
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
