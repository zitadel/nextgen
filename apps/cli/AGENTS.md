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

Anonymous product analytics through Mixpanel's Node SDK (`mixpanel`), plus a
copy of each event to Vercel Web Analytics (`src/lib/telemetry/vercel.ts`).

- Add no other analytics tool or SDK, browser SDK included.
- The Vercel copy sends only `VERCEL_EVENT_KEYS` (`src/lib/oclif/command-telemetry.ts`),
  the catalog's `vercel` list (`catalog.test.ts`); Vercel locates it by IP.
- Development runs (`resolveChannel`, CI included) send no Vercel copy unless
  `ZITADEL_TELEMETRY_VERCEL_ENDPOINT` names an intake.
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
3. List it under its command in the
   [event catalog](../../docs/product-analytics-events.yaml) and on the
   telemetry page; `tests/unit/lib/telemetry/catalog.test.ts` fails when the
   code and the catalog disagree.
4. Check that it arrives in Mixpanel's Live View. The region defaults to `eu`;
   set `ZITADEL_TELEMETRY_REGION=us` for a US project, or events are silently
   dropped.
