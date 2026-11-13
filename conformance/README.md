# SDK conformance lane

Proves each framework SDK against a real server, the way a customer's app
uses it, without scaffolding an app on every run.

- `fixtures/<id>/` is one app per SDK as `zitadel setup` leaves it: the
  framework's own generator at the version the CLI pins, then the built CLI's
  `setup`. Each is a private workspace package, `@zitadel/conformance-<id>`.
- `suite/` (`@zitadel/conformance`) holds the one Playwright spec every
  fixture runs (`src/suite.ts`), the config they share (`src/config.ts`), and
  `conformance-fixture`, which generates a fixture and checks it for drift.

## Commands

| I want to… | Run |
| --- | --- |
| Run the lane for every fixture | `turbo run conformance` |
| Run it for one fixture | `turbo run conformance --filter=@zitadel/conformance-react` |
| Check a fixture for drift | `turbo run check-generate --filter=@zitadel/conformance-react` |
| Regenerate a fixture | `turbo run generate --filter=@zitadel/conformance-react && pnpm install` |
| Sweep servers an aborted run left | `pnpm run cli -- stop --all` |

Run one turbo invocation of the lane at a time: each fixture boots its server
and app on fixed ports.

## What a fixture holds

Nothing in a fixture names a project or a secret. The kit boots a fresh
server and project for every run and hands the app its id, address and
secret through the environment (`env` in the fixture's `playwright.config.mts`).
What setup pins at generation is only the app's dev port and, in a Vite
proxy, the fallback server address; both are the fixture's own ports.

`generate` keeps what setup wrote, less what the lane never reads:

- install output, the secret and the env files that carry it, and the CLI's own
  state (`zitadel.json`, `.zitadel/`), which the app never reads;
- the docs setup writes for a person (`README.md`, `AGENTS.md`);
- every script but `dev`, the dependencies only those scripts used, and the
  generator's unused assets, as `drop` and `dropDependencies` in the fixture's
  `conformance` field list them.

It points `@zitadel/*` at the workspace and a dependency at `catalog:` when
the pnpm catalog holds the generated major. It adds the lane's scripts and
dev dependencies. Beside the app, a fixture has its `conformance` field in
`package.json` (framework, ports, what to drop) and three files of its own:
`playwright.config.mts`, `conformance.spec.ts` and `turbo.json`.

## The drift check

`check-generate` regenerates the fixture into a temp directory and fails, with
a diff, when a kept file differs, is missing or is no longer written. It runs
before the lane, so a stale fixture never passes. It catches changes to the
patchers' templates and edits (pages, proxies and hooks, env declarations), to
the framework CLI pins, and hand edits to a fixture.

It does not catch:

- what `generate` drops (the `.zitadel/` configuration, `zitadel.json`, the docs);
- what setup does to an app that is already set up, or to a pre-existing app
  (`doctor --fix`, upgrade rewrites): it covers only a fresh scaffold;
- generator output that changes without a pin moving, which shows up as drift
  on the next run that misses the cache.

## Adding a fixture

1. Create `fixtures/<id>/package.json` with `name` and a `conformance` field:
   `framework` (a `setup --framework` id) and an `appPort` and `zitadelPort`
   no other fixture or lane uses (fixtures take `32xx` and `82xx`).
2. Copy `playwright.config.mts`, `conformance.spec.ts` and `turbo.json` from a
   fixture of the same family, and set the SDK builds in `turbo.json`.
3. Run the regenerate command above, then `git add -f` any file it reports as
   ignored.
