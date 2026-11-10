# Agent Instructions — `apps/cli`

## Where the rules live

- [`SKILL.md`](skills/zitadel-cli/SKILL.md) is the agent-facing contract (JSON
  envelope, invocation rules, claim, doctor repair). Update it with every
  change to the command surface.
- `command-reference.json` is the docs site's CLI reference, generated from
  `COMMANDS`, `FLAG_VARIABLES` and `EXIT_CODES`: after a change to any of them,
  rerun `tests/unit/lib/oclif/reference.test.ts` with `--update`.
- Running git, and why every call goes through one module:
  [`src/lib/git/AGENTS.md`](src/lib/git/AGENTS.md).
- Tests: [`tests/AGENTS.md`](tests/AGENTS.md). Read it before adding or moving
  a test.
- `start`, `stop`, `status`, `logs`, `reset`, `console`, `doctor` and how
  `setup` finds a local server:
  [`src/lib/local-server/AGENTS.md`](src/lib/local-server/AGENTS.md).
- Imports: reach `src/` with `@/` (`@/lib/errors`), never `../`; `./` stays for siblings.
- Scaffold posture: [ADR 044](../../docs/adrs/044-scaffold-embedding-posture-defaults.md)
  (`src/lib/orca/patchers/posture.ts`); scaffolded-file drift:
  [ADR 042](../../docs/adrs/042-scaffolded-file-ownership-and-drift-detection.md)
  (`src/lib/scaffold-manifest.ts`).
- Claim: [ADR 046](../../docs/adrs/046-claim-lifecycle-v2.md).
- The fresh-app journey: [`e2e/journey/AGENTS.md`](../../e2e/journey/AGENTS.md).
- A command the CLI suggests running next (`next.commands` on a result,
  `nextCommands` on an error, an input question's `retry`) is a
  `SuggestedCommand` from `src/lib/suggestion.ts`, and only its builders make
  one: `this.suggest(args)` on an `EnvironmentCommand` appends the run's
  `--env`/`--env-file`/`--server`; `this.suggestUnscoped(args)` /
  `unscopedCommand` is the deliberate opt-out for a command that targets no
  project (`setup`, `start`, `doctor`); `projectCommand` takes an
  `EnvironmentSelector`, which only `environmentSelectorSuffix` makes;
  `shellCommand` is for anything that is not the CLI, and `inShell` adds a pipe
  or redirection around a suggestion. A raw string does not typecheck there, so
  a retry cannot silently fall back to the default project (#1689).
- Pass a result's next steps as `next` (`src/lib/oclif/next-steps.ts`), never
  in its data: `emit` writes them to the envelope and prints every one.
- A GritQL rule (`biome-plugins/no-raw-next-commands.grit`) rejects a
  hand-written `next_commands:` or `next_actions:` key under `apps/cli/src`.
- Set `nextShown` only when the result's own output showed the steps
  (`setup`'s box).
- Build a result's `pretty` with a factory from `src/lib/oclif/rendering.ts`,
  never a bare string: each spells out what it is given the way that shape
  takes, so no command escapes anything of its own.
  - `prose` for a command's own words for a person, `json` for a body a script
    parses, `rows` for tab-separated records, `painted` for output the CLI
    coloured, whose fragments were spelled out where they were read.
  - Pick by the shape, not by convenience: a JSON body given to `prose` gets
    the terminal spelling and no longer parses.

## Command code

- Read [`docs/styling.md`](docs/styling.md) before changing human output. Style
  it with `src/lib/style.ts`, not `picocolors`; a unit test fails on another import.
- Read a command top-down: its description, group and flags, then what it
  remembers for a run, then `sourceOf`, then `execute`, then the private
  methods `execute` calls. Nothing it calls is declared above it.
- A command does its work in `execute`, never `run`: `BaseCommand.run`
  (`src/lib/oclif/base.ts`) parses the flags, resolves `static meta`, and only
  then calls it.
- Refuse a bad value in the flag or argument itself, so `execute` never checks
  one: a typed `Flags.custom`/`Args.custom` whose `parse` calls a validator
  that throws `refusalError`, or returns `Parsed<T>` where a prompt reuses it.
- Refuse everything else on `execute`'s first lines, in plain code: two flags
  that disagree as an `if`, a precondition the project or server decides as an
  async function returning what it found. There is no framework for either, and
  none is wanted.
- Keep it all in the command's own file: a `const NAME: Refused<T>` above the
  class, named for the flag and nothing else, then the flag declared inline in
  `static flags` as `Flags.custom<T>({ parse: reads(NAME) })({ … })`.
- Never hold a flag in a const to use it once: the declaration belongs at the
  one place the command declares its flags. Only a flag every command takes
  (`serverFlag`, `plainFlag`, the environment flags) has a const, because it
  has no single site.
- Never share one across topics: `start`, `setup` and `doctor` each declare
  `--port`. Within a topic, share it where duplicating would copy real logic —
  `variable/name.ts` holds one argument three variable commands take.
- Name a `Refused` for its flag (`PORT`, `TTL`) and a `Refusal` for what it
  refuses, ending `_REFUSAL`, so the two read apart. A `Refused`'s wording must
  stand on its own: `read` fills `{value}`, `{input}` and `{problem}`, and
  anything else comes from its `values`. A `Refusal` is filled where it is
  thrown. Either way a name nothing fills reaches the person as braces, so a
  unit test weighs every refusal against what fills it
  (`tests/unit/lib/oclif/refusal-wording.test.ts`).
- No `flags/`, `args/` or `rules/` directory, and no helper module beside a
  command.
- Write every refusal once, as a `Refusal` template with `{name}` placeholders
  (`src/lib/oclif/refusal.ts`), never a `ZitadelError` built by hand. Thread
  `this.suggest(...)` in where one names a follow-up: a refusal raised without
  a suggester goes without its follow-ups.
  - A refusal raised while a flag parses names its follow-ups too, unscoped —
    the environment comes from the flags, so there is none to repeat yet. A
    flag whose own `parse` refuses in more than one way passes
    `suggesterOf(command)` (`src/lib/oclif/flags.ts`), as `--design` does.
  - A `next` entry that is only a placeholder takes its value as it is, so a
    check that found two steps hands over both.
- Declare a flag or argument by its CLI spelling and read it as code reads it
  (`"client-id"` is read `flags.clientId`); see `src/lib/oclif/names.ts`.
- Keep the CLI spelling in three places only: the definition key, oclif's own
  cross-references (`char`, `aliases`, `exclusive`, `dependsOn`,
  `relationships`) and the flag as a refusal's message names it.
- Ask the run, never the process: `this.cwd`, `this.env`, `this.isJson`,
  `this.isColored`, `this.isOnScreen` (output on a screen) and `this.isTTY`
  (someone there to ask). A command that reads `process.stdout` or recomputes
  colour has its own answer to a question the run already settled.
- Keep `src/lib/oclif` generic: no product concept and no domain-lib import. A
  unit test fails on a leak (`tests/unit/lib/oclif/layering.test.ts`).
- A domain lib under `src/lib` stays plain functions and parsers, and never
  imports `lib/oclif`.
- Report a warning through `reportWarning` (`src/lib/warnings.ts`) or a
  result's `warnings`, never `consola.warn`: `--json` silences consola. A unit
  test fails on any other `consola.warn`.
- Ask for input through `this.input(...)` (`src/lib/input.ts`), never clack's
  prompts and never a hand-written flag-or-stdin-or-prompt rule. A unit test
  fails on a clack import elsewhere.
- Fail early: run every check that does not depend on an answer before the
  first question, and each one that does as soon as its answer is given.
- Pass `this.signal` (the run's Ctrl-C, `src/lib/oclif/interruptible.ts`) to every
  client and wait a command starts; `createZitadelClient` requires it.
- A command that asks anything extends `Promptable(...)`
  (`src/lib/oclif/promptable.ts`), as in `Promptable(BaseCommand)` or
  `Promptable(EnvironmentCommand)`. Only such a command has `this.input`, so
  what can prompt is visible from its class, and the compiler rejects a
  command that asks without it.
- Word every prompt as a polite question to a person, never a field label or a
  command. Reviewers: reject a prompt that is not one.
  - Write "What is the client ID of your Google OAuth app?", not "Client ID" and
    not "Enter the client ID".
  - Write "Would you like to deploy now?" or "Should we scaffold the app?" for
    a yes or no, and "Which framework would you like to scaffold?" for a choice.
  - Add where the answer comes from or where it goes, in the same message: "It
    will be stored on the project as GOOGLE_CLIENT_SECRET."
  - A confirmation that acts on something may be a short direct question, as
    long as it names the thing and, when it is not obvious, what happens:
    "Delete user usr_1?" or "Revoke rel_1? Its content can never be served again."
  - Leave names and ids in a prompt unquoted ("What is the value of user_id?",
    "Remove FOO from the project?"); a terminal does not render backticks.
  - Ask the same thing the same way in every command that asks it.
- A command that prints a table, a list or a record extends `Tabulatable(...)`
  (`src/lib/oclif/tabulatable.ts`). A record or a table inside another output
  uses `this.tabulate` or `this.tabulateDetail`; a table draws nothing under
  `--json`, and a unit test fails on any other import of `@oclif/table`.
- A list command declares `plain: plainFlag` last in its `flags` and names its
  columns in a `COLUMNS` constant.
- A list command ends with the locals `items`, `rows`, `columns`, `empty`,
  `footer`, `page` and `extra`, empty values spelled out, passed to
  `this.emitList(flags, {...})`.
- Leave plain, the list JSON, the footer and the next-page command to
  `emitList`; a command never builds them.
- A paged list's `page.flags` repeats the flags its token needs, and the command
  overrides `suggestFollowUp` (`EnvironmentCommand` does).
- A command that deletes, revokes or rolls back extends `Destructive(...)`
  (`src/lib/oclif/destructive.ts`) and does it in `this.confirmed({ ... })`.
- Every destructive operation takes a `Consent` (`src/lib/consent.ts`); the
  client withholds the spec's destructive operations until `consent.unlock`.
- Updates are not guarded, though a merge-patch `null` removes what it names;
  guarding them needs a follow-up of its own, not a `Consent`.
- A plain yes or no is `kind: "yes-no"`, which `--force` never answers; only
  `Consent` asks a `confirm`.
- `biome-plugins/no-consent-bypass.grit` rejects every way around `Consent`:
  casts, raw HTTP, `Consent.request` outside the mixin.
- The flag surface follows the [WebCLI spec](https://webcli.com/). Record a new
  global flag, or a deviation, in `SKILL.md`'s invocation rules.
- Declare an environment variable that sets what a global flag sets as a
  `FlagVariable` beside the code that reads it, read it by its `name`, and add
  it to `FLAG_VARIABLES` (`src/lib/oclif/base.ts`).

## Telemetry

Anonymous product analytics: a copy of each event to Vercel Web Analytics
(`src/lib/telemetry/vercel.ts`), and Mixpanel's Node SDK (`mixpanel`), which is
paused.

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
- Mixpanel is paused: `src/lib/telemetry/config.ts` bakes in no token, so only
  `ZITADEL_TELEMETRY_TOKEN` sends to it. Bake one back in only for a project in
  the region its endpoint names; tokens are write-only, published on purpose.
- Without settings a run is production traffic; `ZITADEL_TELEMETRY_ENV=development`
  (`scripts/run-cli.mjs` sets it) is not, and CI sets `DO_NOT_TRACK=1`.
- Mixpanel events for the EU region go through the cloud's
  `/telemetry/mixpanel/*` rewrite in `vercel.json` (`config.test.ts`).
- `ci_provider` and `host_agent` also travel in the HTTP `User-Agent`
  (`src/lib/user-agent.ts`) and obey the same opt-out.
- The docs' [telemetry page](../docs/content/docs/reference/cli/telemetry.mdx)
  tells users what is sent and how to opt out: change it with any of the above.

### Adding a dimension

`cli_command_started`, `cli_command_completed` and `cli_command_failed` fire
from `BaseCommand` for every command. Send a product event of its own
(`this.trackEvent`) only where an ADR names one, as ADR 086 does
`invitation_created`; `catalog.test.ts` holds its properties to the catalog.
Otherwise add a dimension rather than an event:

1. Record it with `this.recordTelemetry({ … })`. It reaches the events fired
   after it, so not `started`. Never fetch data just to record it.
2. Name it `snake_case`; a boolean starts with `is_`, `has_`, `dry_` or
   `non_`. Leave out empty values; `compact()` drops them.
3. List it under its command in the
   [event catalog](../../docs/product-analytics-events.yaml) and on the
   telemetry page; `tests/unit/lib/telemetry/catalog.test.ts` fails when the
   code and the catalog disagree.
4. Check that it arrives in Mixpanel's Live View, with `ZITADEL_TELEMETRY_TOKEN`
   naming the dev project while Mixpanel is paused. The region defaults to
   `eu`; set `ZITADEL_TELEMETRY_REGION=us` for a US project, or events are
   silently dropped.
