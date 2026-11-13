# SDK conformance lane

Proves each framework SDK against a real server, the way a customer's app
uses it, without scaffolding an app on every run.

- `fixtures/<id>/` is one app per SDK as `zitadel setup` leaves it: the
  framework's own generator at the version the CLI pins, then the built CLI's
  `setup`. Each is a private workspace package, `@zitadel/conformance-<id>`.
- `suite/` (`@zitadel/conformance`) holds the one Playwright spec every
  fixture runs (`src/suite.ts`), the config they share (`src/config.ts`), the
  tasks they share (`turbo.json`), and `conformance-fixture`, which generates
  a fixture and checks it for drift.

## Commands

| I want to… | Run |
| --- | --- |
| Run the lane for every fixture | `turbo run conformance` |
| Run it for one fixture | `turbo run conformance --filter=@zitadel/conformance-react` |
| Check a fixture for drift | `turbo run check-generate --filter=@zitadel/conformance-react` |
| Type-check a fixture's pages | `turbo run typecheck --filter=@zitadel/conformance-react` |
| Regenerate a fixture | `turbo run generate --filter=@zitadel/conformance-react && pnpm install` |
| Sweep servers an aborted run left | `pnpm run cli -- stop --all` |

Run one turbo invocation of the lane at a time: each fixture boots its server
and app on fixed ports.

## What a fixture holds

Nothing in a fixture names a project or a secret. The kit boots a fresh
server and project for every run and hands the app its id, address and
secret through the environment (`env` in the fixture's `playwright.config.mts`).
What setup pins at generation is the app's dev port and, in a Vite proxy, a
fallback server address (`generatePort`), which the kit's `ZITADEL_URL`
overrides.

Its contract is the `conformance` field in its `package.json`:

| Field | |
| --- | --- |
| `framework` | the `setup --framework` id |
| `appPort` | the app's dev port, set up with `--dev-port` and used by the lane |
| `zitadelPort` | the lane's server |
| `generatePort` | the server `generate` and `check-generate` set the app up against |
| `generatorPinned` | `false` for a framework generator its pin does not fix (it fetches a template or asks npm for `latest`); its drift check then runs only in the nightly run |

Fixtures take `32xx`, `82xx` and `83xx` with the same `xx`.

`generate` keeps what a commit of the app would hold, by the app's own
`.gitignore` (which leaves out install output and generated types such as
`.nuxt/` and `next-env.d.ts`), less what no fixture commits: the secret and
the env files that carry it, the CLI's own state (`zitadel.json`,
`.zitadel/`), which the app never reads, the docs setup writes for a person
(`README.md`, `AGENTS.md`), and editor and npm settings. Of the generated
scripts it keeps `dev` and the generator's own type-check as `typecheck`
(sv's `check`, the `tsc -b` or `vue-tsc -b` create-vite's `build` starts
with). It points `@zitadel/*` at the workspace and a dependency the pnpm
catalog holds at `catalog:`, and fails when the catalog's floor is below
what the generator writes, naming the bump; a catalog ahead of it
(create-next-app's exact pins and older majors) stays `catalog:`, so a
fixture never runs an older release than a customer gets. It adds the
lane's scripts and dev dependencies. Beside the app, a fixture has three files of its own:
`playwright.config.mts`, `conformance.spec.ts` and `turbo.json`, which only
extends the suite's.

The lane runs the app with the SDKs linked from the workspace, so it proves
the SDKs' code, not the packed package (exports, `files`, peer ranges); the
journeys prove those.

## The drift check

`check-generate` regenerates the fixture into a temp directory and fails, with
a diff, when a kept file differs, is missing or is no longer written. It
catches changes to the patchers' templates and edits (pages, proxies and
hooks, env declarations), to the framework CLI pins, and hand edits to a
fixture. It is cached, and reruns when the CLI build, the server build, the
kit, the suite or the fixture changes. The `ci` script names it beside
`conformance`, so a registry outage in the check never skips the lane.

It does not catch:

- what `generate` drops (the `.zitadel/` configuration, `zitadel.json`, the docs);
- what setup does to an app that is already set up, or to a pre-existing app
  (`doctor --fix`, upgrade rewrites): it covers only a fresh scaffold;
- generator output that changes without a pin moving, which shows up on the
  next run that misses the cache (and every night for `generatorPinned: false`).

## Adding a fixture

1. Create `fixtures/<id>/package.json`:

   ```json
   {
     "name": "@zitadel/conformance-<id>",
     "private": true,
     "scripts": { "generate": "conformance-fixture generate" },
     "devDependencies": { "@zitadel/conformance": "workspace:*" },
     "conformance": { "framework": "<id>", "appPort": 32xx, "zitadelPort": 82xx, "generatePort": 83xx }
   }
   ```

2. Copy `turbo.json`, `playwright.config.mts` and `conformance.spec.ts` from
   a fixture of the same family; set the env template and the spec's options
   for the framework.
3. Run `pnpm install && turbo run generate --filter=@zitadel/conformance-<id> && pnpm install`.
