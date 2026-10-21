# Agent Instructions — `apps/cli`

## Where the rules live

- [`SKILL.md`](skills/zitadel-cli/SKILL.md) is the agent-facing contract (JSON
  envelope, invocation rules, claim, doctor repair). Update it with every
  change to the command surface.
- `command-reference.json` is the docs site's CLI reference, generated from
  `COMMANDS`, `FLAG_VARIABLES` and `EXIT_CODES`: after a change to any of them,
  rerun `tests/unit/lib/oclif/reference.test.ts` with `--update`.
- Tests: [`tests/AGENTS.md`](tests/AGENTS.md). Read it before adding or moving
  a test.
- `start`, `stop`, `status`, `logs`, `reset`, `console`, `doctor` and how
  `setup` finds a local server:
  [`src/lib/local-server/AGENTS.md`](src/lib/local-server/AGENTS.md).
- Scaffold posture: [ADR 044](../../docs/adrs/044-scaffold-embedding-posture-defaults.md)
  (`src/lib/orca/patchers/posture.ts`); scaffolded-file drift:
  [ADR 042](../../docs/adrs/042-scaffolded-file-ownership-and-drift-detection.md)
  (`src/lib/scaffold-manifest.ts`).
- Claim: [ADR 046](../../docs/adrs/046-claim-lifecycle-v2.md).
- The fresh-app journey: [`e2e/journey/AGENTS.md`](../../e2e/journey/AGENTS.md).
- A command the CLI suggests running next (`nextCommands` on a result or an
  error, `next_commands` in data, an input question's `retry`) is a
  `SuggestedCommand` from `src/lib/suggestion.ts`, and only its builders make
  one: `this.suggest(args)` on an `EnvironmentCommand` appends the run's
  `--env`/`--env-file`/`--server`; `this.suggestUnscoped(args)` /
  `unscopedCommand` is the deliberate opt-out for a command that targets no
  project (`setup`, `start`, `doctor`); `projectCommand` takes an
  `EnvironmentSelector`, which only `environmentSelectorSuffix` makes;
  `shellCommand` is for anything that is not the CLI, and `inShell` adds a pipe
  or redirection around a suggestion. A raw string does not typecheck there, so
  a retry cannot silently fall back to the default project (#1689). Data
  carries its suggestions through `nextCommandsData()`; a GritQL rule
  (`biome-plugins/no-raw-next-commands.grit`) rejects a hand-written
  `next_commands:` key under `apps/cli/src`.

## Command code

- Report a warning through `reportWarning` (`src/lib/warnings.ts`) or a
  result's `warnings`, never `consola.warn`: `--json` silences consola. A unit
  test fails on any other `consola.warn`.
- Ask for input through `this.input(...)` (`src/lib/input.ts`), never clack's
  prompts and never a hand-written flag-or-stdin-or-prompt rule. A unit test
  fails on a clack import elsewhere.
- A command whose `--force` means something other than "yes to every
  confirm" builds its own asker with `force: false`, as `setup` does.
- The flag surface follows the [WebCLI spec](https://webcli.com/). Record a new
  global flag, or a deviation, in `SKILL.md`'s invocation rules.
- Declare an environment variable that sets what a global flag sets as a
  `FlagVariable` beside the code that reads it, read it by its `name`, and add
  it to `FLAG_VARIABLES` (`src/lib/oclif/base.ts`).

## Telemetry

Anonymous product analytics through Mixpanel's Node SDK (`mixpanel`).

- Add no other analytics tool or SDK, browser SDK included.
- Send nothing that identifies a person, machine or credential: no user,
  email, name, IP, URL, project id, file path, secret or free text. Allowed
  values are enums, booleans, counts and versions.
- The install id is a random UUID (`src/lib/telemetry/identity.ts`); there is
  no `identify()`. The server URL is bucketed into `server_kind`, and the
  country comes from the timezone with `ip: 0`.
- Consent is opt-out (`--no-telemetry`, `DO_NOT_TRACK`, `ZITADEL_TELEMETRY=0`)
  and resolved once in `resolveConsent` (`src/lib/telemetry/consent.ts`).
  Never send around it.
- `BaseCommand` (`src/lib/oclif/base.ts`) is the only place a client is
  built; CLI-specific properties live in `src/lib/oclif/command-telemetry.ts`.
- Telemetry never writes to stdout and never fails a command. The first-run
  notice goes to stderr, in interactive mode only.
- The baked-in ingestion tokens (`src/lib/telemetry/config.ts`) are write-only
  and published on purpose. Without settings, events go to the production
  project; `ZITADEL_TELEMETRY_ENV=development` selects the dev project, and CI
  sets `DO_NOT_TRACK=1`.
- `ci_provider` and `host_agent` also travel in the HTTP `User-Agent`
  (`src/lib/user-agent.ts`) and obey the same opt-out.
- The docs' [telemetry page](../docs/content/docs/reference/cli/telemetry.mdx)
  tells users what is sent and how to opt out: change it with any of the above.

### Adding a dimension

`cli_command_started`, `cli_command_completed` and `cli_command_failed` fire
from `BaseCommand` for every command. Add a dimension rather than an event:

1. Record it with `this.recordTelemetry({ … })`. It reaches the events fired
   after it, so not `started`. Never fetch data just to record it.
2. Name it `snake_case`; a boolean starts with `is_`, `has_`, `dry_` or
   `non_`. Leave out empty values; `compact()` drops them.
3. List it below and on the telemetry page, then cover it in
   `tests/unit/lib/telemetry/`. The `setup-dimensions` and
   `variables-dimensions` tests fail on a recorded dimension their line below
   does not name.
4. Check that it arrives in Mixpanel's Live View. The region defaults to `eu`;
   set `ZITADEL_TELEMETRY_REGION=us` for a US project, or events are silently
   dropped.

Dimensions each command records:

- **setup** — `framework`, `renderer`, `package_manager`, `scaffolded_skeleton`, `skip_install`, `dev_port_explicit`, `preset`, `use_case`, `sso` (an `IDP_PROVIDERS` slug, `custom` for a developer-described connection but never its slug, `none`, or `multiple`), `files_written_count`, `step` (`framework_resolved` → `project_created` → `files_patched` → `dependencies_installed`).
- **branding eject** — `design` (a `BRANDING_DESIGNS` value).
- **deploy** — `resources` (how many the bundle pinned) and `origin_count` (how many origins it went live on). Counts only; never a handle, a digest, or an origin.
- **doctor** — `runtime`, `checks_total`, `checks_failed`, `checks_warn`, `failed_checks` (check names, never messages).
- **start** — `runtime` (`binary` / `docker`).
- **variables** — `is_secret`, `variable_count`. Never the variable's name or value.
- **api** — `operation` (an `operationId` of the spec, never a path, an id or a field), `is_paginated`.
- **any command that connects to a project** (`EnvironmentCommand.connect`, so every one but `setup`, `doctor` and the local-server commands) — `credential` (`project` / `preview`), `has_env_file` (whether `--env-file` was given). Deliberately *not* recorded: the environment's name, the env file's path, the server, the project id, or any resolved value — every one of them is a name, a URL, an id or a secret.
- **claim** — `claim_outcome` (`completed` / `already_claimed` / `expired` / `window_expired` / `timeout` / `dry_run`), `poll_count`, `browser_opened`. Never an id or a URL.
