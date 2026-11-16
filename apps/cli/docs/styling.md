# CLI styling

How the CLI's human output looks. Read this before adding or changing what a
command prints. `--json` is a separate contract: [ADR 004](../../../docs/adrs/004-agent-contract-and-agents-md.md)
and [`SKILL.md`](../skills/zitadel-cli/SKILL.md).

## Streams

- `--json` prints one envelope on stdout and nothing else.
- A command's result goes on stdout. Anything extra goes on stderr when a script
  may read stdout, and only with a terminal on both streams, as the update box
  under `--version` does.
- Report a warning as `apps/cli/AGENTS.md` says, not by printing one.

## Color and marks

Everything comes from [`src/lib/style.ts`](../src/lib/style.ts), which names what
text is. A unit test fails on another `picocolors` import. Add a new kind of text
there, not a new color at the call site.

| Helper | For | Example |
| --- | --- | --- |
| `command` | a command to run | `npx @zitadel/cli@latest upgrade` |
| `path`, `url` | something to open | `.zitadel/secret` |
| `id` | an opaque id, left plain | `proj_123` |
| `dim` | separators and secondary detail | `2 checks passed` |
| `strong` | titles, and what needs attention | `Credentials` |
| `mark.pass`, `mark.warn`, `mark.fail` | the result of something | `✓`, `!`, `✗` |
| `arrow` | what a thing leads to: its fix, its file | `→` |

- Green, yellow and red mean an outcome: passed, needs attention, failed.
- Never rely on color alone. Output must read the same with `--no-color`, so a
  status always has its mark or a word such as `Warning:`.
- Adding color must not change piped output: scripts read those words.
- Narration is `log` (`src/lib/log.ts`): a wizard draws each level with its
  mark, and every other command says it as a plain line.
- Color follows stdout's terminal. Write to stderr through `BaseCommand`, which
  takes the codes back out when only stderr is redirected.
- Use `statusColor` for a mark in another shape, like `doctor`'s `[✓]`.
- Every helper spells out what it is given, the plain ones included: a fragment
  from here goes into a `painted` rendering, which is printed as it came so the
  color survives, so a value the server answered has to be safe before it gets
  there. Pass a value through the palette rather than escaping it at the call
  site, and spell one out yourself only where no helper touches it.

## Layout

- A run's headline is `strong`. A group of facts, as in `setup`'s summary, has a
  `dim` uppercase title. A status has its mark and label, as `doctor`'s rows do.
- Lead with the result. Collapse what is healthy, and put detail behind `-v`.
- Indent a problem under what it belongs to, with its fix on the next line.
- Say one cause once. `-v` is the exception: it lists every check by name.
- Wrap to the terminal's width. Do not wrap piped output, or a terminal that
  reports no width.
- Never print a raw system error such as `ENOENT`: say what is wrong in the
  user's terms. Show a path relative to the project where one exists.

## Boxes

- Box only a moment that ends a run or needs attention, never a routine result.
- Draw one with `drawBox` ([`src/lib/ui/layout.ts`](../src/lib/ui/layout.ts)),
  its content through `wrapForBox` ([`src/lib/box.ts`](../src/lib/box.ts)), so
  the frame fits the terminal.
- Green is for a run that succeeded, cyan (`notice`) for what to read or do.
- Put nothing in a box that must be copied whole, such as a long URL: print it
  on its own line below the frame.

## What to run next

- Build a suggested command as `apps/cli/AGENTS.md` says, and hand it to `emit` as
  the result's `next`. A command that draws its next steps itself passes
  `nextShown`, so they are not printed twice.
- Pull the one command that fixes a problem out of its sentence, on a line of its
  own, so it can be copied.

## Tests

- Test wording and layout in a unit test of the renderer, as
  [`report.test.ts`](../tests/unit/cli/commands/doctor/report.test.ts) does.
- In a spec, assert only what a user would notice, with `toPrint`
  ([`tests/AGENTS.md`](../tests/AGENTS.md)).
- A test sees no color: `picocolors` is off without a terminal. Check a colored
  run by hand in a real terminal when you change the palette.
