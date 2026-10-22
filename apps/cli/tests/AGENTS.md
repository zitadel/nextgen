# Agent Instructions — `apps/cli/tests`

Package rules: [`../AGENTS.md`](../AGENTS.md).

## Two kinds of test

Every file here is a unit test or a spec. A test that is neither gets
reclassified until it is one.

- **Unit tests** (`tests/unit/**/*.test.ts`) import from `src/` (or read a
  checked-in file) and mirror its layout: `src/lib/idp/credentials.ts` →
  `tests/unit/lib/idp/credentials.test.ts`. One file may cover a cohesive
  directory if the mirror path stays obvious. Doubles are fine.
- Unit tests own all detail: wording, key order, classification, renderer
  output, validation messages, id prefixes, envelope fields. A spec never
  asserts what a unit test can, so a failure names the module that broke.
- **Specs** (`tests/integration/**/*.spec.ts`) drive the built CLI through
  `runCliForTest` against `@zitadel/api-mock`'s platform handlers and assert
  only what a developer could observe.
- One spec file per command, named after it (`variables-set.spec.ts`), the
  only spec that drives that command. No cross-command, "contract" or
  "round-trip" files.
- A property every command must have lives in the fixture: `ScaffoldedApp`
  checks the envelope contract on every `--json` run.
- The binary's own behaviour (unknown command, server resolution) is
  `cli.spec.ts`. The generated resource commands share one factory
  (`src/lib/oclif/crud/`): unit-test the factory, and `resources.spec.ts`
  proves it is wired.

## The shape of a spec

```ts
const platform = usePlatformMock();

describe("auth-method sso enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still writes the provider into the project", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.enableSso("google", CREDENTIALS);

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => { … });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("registers nothing with the platform until apply", async () => {
        const app = await aSetUpApp();

        await app.enableSso("google", CREDENTIALS);

        expect(await app.registeredIdps()).toEqual([]);
      });
    });

    describe("rendered for a terminal", () => { … });
  });
});
```

Three rules make that shape hold:

1. **Arrange with flags, act on your own command.** A spec may run other
   commands to reach its starting state, but only non-interactively and without
   asserting on them. `setup.spec.ts` is the only place the setup wizard is the
   subject.
2. **Observe by running a command.** A spec's subject is how the CLI behaves,
   not how it stores things, so what a command did is checked by running
   another one: `idps list`, `schemas list`, `flow-definitions list`,
   `variables list --project-level`, `deployment list`. Never `.zitadel/state.json` and
   never the mock's own store — a corrupt file matters only insofar as a later
   command surfaces it, and that surfacing is the assertion.

   A committed file may be read where its content *is* the behaviour, through
   `app.committed`: chiefly that a credential is a `${{ VARIABLE }}` reference
   and never a literal, because a secret in version control cannot be scrubbed
   later. Nothing else — not prose copy, key ordering, generated file contents
   or marker files, all of which a unit test reaches faster.
3. **One journey per test.** A test that runs setup, then doctor, then deploy, then
   rollback, then reruns is not a spec; it is five specs sharing a temp directory.
   Split it and let each command's spec own its own leg.

Use `it.each` for anything that varies by framework, preset or resource. A spec
suite is a table plus a journey, not a sequence of hand-written near-duplicates.

A spec body contains a fixture call, a command, and matchers — nothing else:

- **No paths.** Edit through `app.editUserSchema`, `app.editLoginFlow`,
  `app.editPackageJson`, `app.addFlow`; arrange through `app.writeConfig` and
  `app.writeLocalSecret`. A `.zitadel/...` string in a spec is only ever a
  value the CLI reported back.
- **No HTTP.** The platform is arranged in its own terms —
  `platform.rejectsSchemaUploads()`, `platform.recovers()`,
  `platform.capturesBrandingPublishes()`. msw stays in `helpers/platform.ts`.
- **One assertion vocabulary**, from `tests/helpers/matchers.ts`: `toSucceed`,
  `toFail`, `toFailWith`, `toExitWith`, `toBeSkipped`, `toExplain`, `toHintAt`,
  `toSuggest`, `toPrint`, `toPrintNoJson`, `toSay`, `toReportNothingToDo`.
  Never a bare `exitCode` compare. Rendered output is asserted with `toPrint`,
  which reads stdout alone — `toSay` spans stdout and stderr, so it cannot tell
  a summary printed to the wrong channel from one printed to the right one.
- **No comments.** A step that needs explaining needs a named helper with a
  line of TSDoc instead.
- **One shape**: arrange, blank line, a single command under test, blank line,
  assertions. One claim per test — split rather than assert two things.
- **One skeleton.** Every suite is two top-level groups, in this order:

  ```ts
  describe("<command>", () => {
    describe("against an invalid server", () => {
      describe("that is not a zitadel api", () => { ... });
      describe("that is down", () => { ... });
    });

    describe("against a valid server", () => {
      describe("--json", () => { ... });
      describe("rendered for a terminal", () => { ... });
    });
  });
  ```

  The first group says what the command does when the server it is pointed at
  cannot serve the request: one that answers but is not a Zitadel API, and one
  that is down. Most fail. Some carry on deliberately, for one of two reasons:
  they never needed the server — `resources` describes the command surface,
  `stop`, `reset` and `eject` act on the machine — or they reach it and
  tolerate the failure, as `auth-method sso enable` does for publishing the
  credentials, and `doctor` and `status` for their probes. Either way it is
  worth stating rather than leaving to be discovered, and each spec's own first
  group is the record, not this sentence. The `--json` and rendered groups
  never interleave, and a command with no human-rendered output has no second
  one.

Formatting is Biome's, per the repo's `biome.json`, so nothing is
hand-wrapped.

One exception, in `cli.spec.ts`: it scans `src/**` for the commands the CLI
suggests, and checks each one against the command list the built CLI reports.
Reading source from a spec is otherwise forbidden, but the assertion is the
cross-check between the two sides — split it and each half proves nothing, so
it stays here deliberately rather than by oversight.

## Prohibited in specs

- No doubles of our own modules. Fake an external binary on `PATH` if needed.
- Never a real Zitadel. If the mock cannot express a behaviour, teach the mock
  first.
- Where the mock accepts what the real engine refuses, a comment names the
  server-side validator the spec stands in for.

## Ports and network

- A port handed to the CLI comes from `nextPort()`
  ([`helpers/ports.ts`](helpers/ports.ts)), never a bind-and-close probe:
  another worker's outbound connection can take it first (`E_PORT_IN_USE`).
  Never retry on that. A listener held for the whole test may bind port 0.
- No test leaves the machine: [`helpers/offline.ts`](helpers/offline.ts) fails
  any connection off loopback.
- A unit test answers the platform with
  `setupServer(...setupPlatformHandlers())` and
  `onUnhandledRequest: "error"`; a spec with `usePlatformMock()`. A command
  without `--server` talks to `DEFAULT_SERVER`, the real platform, so it needs
  the same.
