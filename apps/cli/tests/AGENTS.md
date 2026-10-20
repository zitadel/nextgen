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

- **Two top-level groups, in that order.** The invalid-server group states
  what the command does against a server that is not a Zitadel API and one
  that is down, including when it carries on regardless. The `--json` and
  rendered groups never interleave; drop the second if nothing is rendered.
- **Arrange with flags, act on your own command.** Reach the starting state
  through other commands, non-interactively and unasserted. `setup.spec.ts`
  alone has the wizard as its subject.
- **Observe by running a command** (`idps list`, `plan`, …, through helpers
  like `app.registeredIdps()`), never by reading `.zitadel/state.json` or the
  mock's store.
- Read a committed file (`app.committed`) only where its content is the
  behaviour: a credential is a `${{ VARIABLE }}` reference, never a literal.
- **One journey and one claim per test**: arrange, blank line, one command,
  blank line, assertions. Use `it.each` for what varies by framework, preset
  or resource.
- **No paths**: edit and arrange through `app.edit*`, `app.addFlow`,
  `app.writeConfig`, `app.writeLocalSecret`.
- **No HTTP**: arrange the platform in its own terms (`platform.recovers()`,
  …); msw stays in `helpers/platform.ts`.
- **Only the matchers in `helpers/matchers.ts`**, never a bare `exitCode`
  compare. Assert rendered output with `toPrint` (stdout alone), not `toSay`,
  which spans both channels.
- **No comments** (one exception below): a step that needs one becomes a
  named helper with TSDoc.
- `cli.spec.ts` alone may read `src/**`: it checks the commands the CLI
  suggests against the command list the built CLI reports.

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
