# Agent Instructions — `e2e/api-contract`

Checks the API against its own spec. Schemathesis generates requests from the
OpenAPI document and fires them at a real instance of this working tree's
server; Vitest judges what it found. Paths below are from the repo
root.

## How it runs

- `turbo run api-contract --filter=@zitadel/e2e` builds the server, then runs
  `src/api-contract.test.ts`. Its fixtures (`src/fixtures.ts`) are built before
  the first test and torn down after the last, with no global setup: a real
  instance of the server (`startLocalZitadel`, binary runtime, SQLite) whose
  `/api/v1/openapi.json` is the spec under test, and one idle Schemathesis
  container (the pinned image, through Testcontainers) with that spec mounted.
  Docker is required.
- `src/contract.ts` runs several commands in that one container at the same
  time, each on a project of its own on the instance (its own secret, users,
  sessions and branding), so what one creates, changes or deletes is never seen
  by another: `shard-N` commands, each a share of the operations but the logout
  (`src/shards.ts` deals them by a hash of the operation's name, so an
  operation stays in its shard when others come and go), a `stateful` command
  for the multi-step phase, which needs them all in one run, and a `logout`
  command, because it ends the session it runs on. The spec decides the
  operations and, from each one's declared `security` (`src/spec.ts`), which
  credential it gets: Schemathesis applies the project secret to the bearer
  operations and a seeded end user's cookie to the cookie ones. The CSRF token
  rides only on the cookie operations (`[operations.headers]`).
- The suite has one test for the run's completion, one for its accounting and
  one for the baseline verdict, which lists every operation that differs. The
  raw report and output are in `api-contract/test-output/schemathesis/<command>/` (`shard-N`, `stateful`, `logout`)
  (gitignored), and `st replay <id>` in the image replays a case.
- The run takes about a minute and a half on CI. Turbo caches a passing run on the server build and the lane's own files, so a change that touches neither replays it. A failing run is never cached.
- The verdict names each broken operation and shows the response and the `curl`
  request that broke it, with credentials and tokens left out (`src/details.ts`
  reads them from Schemathesis's printed output) and the `st replay` id. It is
  written as Markdown to `api-contract/test-output/summary.md` and the job
  summary on GitHub, as plain text to the log (folded away when nothing broke),
  and as one error annotation per operation on the check, which points at the
  operation's definition in the spec's source (`src/sources.ts`) so it shows on
  that line when the pull request changes the file. Vitest's console capture is
  off for this lane (`disableConsoleIntercept`), so the log is not interleaved
  with `stdout | ...` headers.

## The baseline

`known-failures.json` lists the failures the API has today. It is a ratchet:

- A failure that is not listed fails its operation's test. That is a
  regression, or an endpoint the spec describes wrongly.
- A listed failure that no longer happens also fails its operation's test, so a
  fix has to remove its line. The list only shrinks.

After fixing something, or when a change is meant to alter the baseline, rewrite
it from a run and read the diff:

```sh
API_CONTRACT_UPDATE_BASELINE=1 turbo run api-contract --filter=@zitadel/e2e
```

Never add a line to hide a failure you introduced. Fix it, or fix the spec.

## Keeping it deterministic

A baseline is only worth anything if a run repeats.

- Each command is one process with one worker, on a project of its own, so
  nothing one command does can reach another. Parallelism comes from the
  number of commands (`API_CONTRACT_SHARDS`, default 4), not from workers:
  `API_CONTRACT_WORKERS` (default 1) is requests in flight inside a command,
  and with more than 1 they share that command's project and find failures
  that come and go. Measured on CI with identical commits, this setup repeats
  exactly.
- `--generation-database none` keeps Hypothesis from replaying the examples an
  earlier run left in `.hypothesis/`, which every command in the container
  shares; without it, two same-seed runs send different requests.
- A command draws the inputs of its operations from a single seeded stream, so
  adding or removing an operation can change what the others in its shard
  receive. A change to the spec can therefore change the baseline: regenerate
  it from the new run and read the diff.
- The Schemathesis release and the seed are pinned in `src/schemathesis.ts` (release) and `src/command.ts` (seed).
  Bumping the release adds checks, so regenerate the baseline in the same
  change and say so.
- The checks are listed by name instead of `--checks all`, which adds a
  10-second response limit. Speed depends on the machine and is not a contract
  property.
- A fuzzed schema URL makes the server fetch an arbitrary host. The answer is a
  `400` whichever way the fetch fails, so the baseline does not depend on it,
  but the run does reach the network.

## What the lane is told to accept

Every entry is in `src/checks.ts` with its reason; remove an entry when the
cause goes away.

- `REFUSALS`: operations whose valid-looking requests the server may refuse with
  `400` (a value checked by content, a referenced project or schema that must
  exist, rules across properties). The `positive_data_acceptance` check never
  accepts a `400` on its own.
- `EXEMPTIONS`: one check switched off for one operation (`getTeam` keeps a
  deactivated team; `submitFlowStep` documents its `400` as a step).
- `ignored_auth` is switched off for each operation that lists two security
  alternatives (a bearer or a cookie): the check removes only one, so the other
  still authenticates the request. Operations with one keep it.

`hooks.py` is loaded into every run (`SCHEMATHESIS_HOOKS`). A page token is
opaque and only one the server issued is valid, so it keeps `page_token` out of
every request meant to be valid, which tests each list's first page and needs
no entry per paged operation. It also turns a float an integer holds exactly
(`79.0`) into an integer, which the server's decoder requires.

Checks are selected in the generated `schemathesis.toml`, never with
`--checks`: the flag overrides a per-operation exemption.

## What it does not cover

- The flow engine's own `_zflow` cookie is a parameter, not a declared
  security scheme, so a multi-step flow is not walked with it.
- It generates at most `MAX_EXAMPLES` (25) test cases per operation; raise it
  in `src/command.ts` for a deeper run.
- It checks that the server and the spec agree, not that either is right:
  behaviour belongs in the Go integration tests.
