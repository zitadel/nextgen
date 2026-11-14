# Agent Instructions — `e2e/api-contract`

Checks the API against its own spec. Schemathesis generates requests from the
OpenAPI document and fires them at a real instance of this working tree's
server; Vitest reports one test per operation. Paths below are from the repo
root.

## How it runs

- `turbo run api-contract --filter=@zitadel/e2e` builds the server, then runs
  `api-contract/global-setup.ts`: it boots an instance with
  `startLocalZitadel` (binary runtime, SQLite), fetches the spec the instance
  serves at `/api/v1/openapi.json`, and runs the pinned Schemathesis image
  through Testcontainers once per family. Docker is required.
- The spec decides the families, from each operation's declared `security`
  (`src/spec.ts`), and `src/credentials.ts` gives each its credentials:
  `public` sends none, `management` the project secret, `session` a seeded
  end user's cookie and CSRF token, `logout` a session of its own, because it
  ends the session.
- `src/contract.test.ts` has one test per operation, named `METHOD /path`, plus
  one per family for the multi-step phase (`Stateful tests (<family>)`). A
  failing test names the check; the raw report and output are in
  `api-contract/test-output/schemathesis/<family>/` (gitignored), and `st replay
  <id>` in the image replays a case.
- The run takes about two minutes. Turbo caches a passing run on the server build and the lane's own files, so a change that touches neither replays it. A failing run is never cached.
- The verdict is written to `api-contract/test-output/summary.md`, to the job summary on GitHub, and as error annotations on the check.

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
