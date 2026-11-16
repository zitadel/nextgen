# Agent Instructions — `conformance/`

What the lane is and its commands: [README.md](README.md).

- Never hand-edit a fixture's generated files; change the CLI and run
  `turbo run generate --filter=<fixture> && pnpm install`.
- Change how every fixture is normalized only in `suite/bin/conformance-fixture.mjs`;
  a fixture's contract is its `conformance` field (framework and ports), nothing more.
- Never commit a secret, an `.env` file with values or `.zitadel/`: the kit
  supplies the project through the environment.
- Keep a fixture's own files to `playwright.config.mts`, `conformance.spec.ts`
  and a `turbo.json` that only extends `@zitadel/conformance`; the drift check
  treats anything else as generated.
- Define the fixtures' tasks once, in `suite/turbo.json`; `^build` there is
  what gives a fixture its SDKs' builds.
- Put framework knowledge the spec needs in the fixture's `conformance.spec.ts`
  options, never as a branch on the framework in `suite/src/suite.ts`.
