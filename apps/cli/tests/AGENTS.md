# Test Instructions — `apps/cli/tests`

These instructions apply to `apps/cli/tests/**`. Defer to [`../AGENTS.md`](../AGENTS.md)
for package rules and the root `AGENTS.md` for repository-wide ones.

## There are exactly two kinds of test

Every file under `tests/` is a unit test or a spec. Nothing else. A test that is
neither does not get written — it gets reclassified until it is one of them.

### Unit tests — `tests/unit/**`

A unit test imports from `src/` (or reads a checked-in file) and asserts on what
it imported. It mirrors the layout of `src/`, so `src/lib/idp/credentials.ts` is
covered by `tests/unit/lib/idp/credentials.test.ts`. Where a directory is one
cohesive unit, a single file may cover it — `tests/unit/commands/doctor/checks.test.ts`
covers every check — but the mirror path must still be obvious from the name.

Doubles are fine here. **Unit tests own all the detail**: wording of guidance and
errors, key ordering, file classification, renderer output, validation messages,
id prefixes, envelope fields. If a behaviour can be asserted by importing a
module, that is where it belongs, and a spec must not assert it again.

### Specs — `tests/integration/**`

A spec drives the built CLI through `runCliForTest` against
`@zitadel/api-mock`'s platform handlers, and asserts only what a developer could
observe afterwards.

**One spec file per command, named after the command.** `setup.spec.ts`,
`plan.spec.ts`, `sso-enable.spec.ts`, `variables.spec.ts`. A command's spec is
the only spec that drives that command as its subject. There are no
cross-command spec files, no "contract" files and no "round-trip" files.

A property that must hold for *every* command belongs in the fixture, not in a
suite of its own. The envelope contract works this way: `ScaffoldedApp` checks
it on every `--json` invocation, so every spec gets it for free and a
regression fails inside the spec of the command that broke. A dedicated
contract suite only ever covers the commands somebody remembered to list, and
reports the failure far from its cause.

The generated resource commands (`users:list`, `teams:get`, …) come from one
factory in `src/lib/oclif/crud/`. They are one spec — `resources.spec.ts`,
parameterized over the resource table — not one per generated command. The
factory's behaviour is unit-tested; the spec proves it is wired up.

## The shape of a spec

```ts
describe("<command>", () => {
  it("<what the developer gets>", async () => {
    const app = await aNextApp();
    await app.setup();                 // arrange with flags, non-interactively

    const result = await app.ssoEnable({ provider: "google", ...CREDENTIALS });

    expect(result.exitCode).toBe(0);
    expect(snapshotPlatformStore().idpSlugs).toEqual(["google"]);
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
   `variables list --project-level`, `plan`. Never `.zitadel/state.json` and
   never the mock's own store — a corrupt file matters only insofar as a later
   command surfaces it, and that surfacing is the assertion.

   A committed file may be read where its content *is* the behaviour, through
   `app.committed`: chiefly that a credential is a `${{ VARIABLE }}` reference
   and never a literal, because a secret in version control cannot be scrubbed
   later. Nothing else — not prose copy, key ordering, generated file contents
   or marker files, all of which a unit test reaches faster.
3. **One journey per test.** A test that runs setup, then doctor, then plan, then
   apply, then reruns is not a spec; it is five specs sharing a temp directory.
   Split it and let each command's spec own its own leg.

Use `it.each` for anything that varies by framework, preset or resource. A spec
suite is a table plus a journey, not a sequence of hand-written near-duplicates.

Assert through the matchers in `tests/helpers/matchers.ts` — `toSucceed`,
`toFailWith`, `toExplain`, `toHintAt`, `toSuggest`, `toSay`, `toBeSkipped`,
`toReportNothingToDo`. A spec body carries no comments: if a step needs
explaining, it needs a named helper with a line of TSDoc instead.

One exception, in `cli.spec.ts`: it scans `src/**` for the commands the CLI
suggests, and checks each one against the command list the built CLI reports.
Reading source from a spec is otherwise forbidden, but the assertion is the
cross-check between the two sides — split it and each half proves nothing, so
it stays here deliberately rather than by oversight.

## Prohibited in specs

- **No listen-on-zero port probes.** A bind-then-close probe races the other
  vitest workers, and retrying on `E_PORT_IN_USE` hides the race rather than
  fixing it. Take a port from a per-worker allocation, the way
  [`apps/cli-journey-e2e/AGENTS.md`](../../cli-journey-e2e/AGENTS.md) requires.
- **No doubles of our own modules.** A spec that stubs something in `src/` has
  stopped being a spec. Fake an external binary on `PATH` if the journey needs
  one; never fake our own code.
- **Never a real Zitadel.** The mock answers everything. If the mock cannot
  express the behaviour under test, teach the mock — do not reach for a server,
  and do not assert the behaviour at all until the mock is honest about it.
- **No assertions the mock cannot justify.** The mock accepts some things the
  real engine refuses (`idp.field_immutable` on a changed issuer, say). Where a
  spec stands in for a server-side rule, say so in a comment naming the
  validator, so the gap is explicit rather than assumed covered.

## Why it is split this way

Detail asserted in a spec is asserted slowly, once, through the whole CLI, and
it fails with a stack trace pointing at the journey rather than the defect. The
same detail asserted in a unit test runs in milliseconds and names the module
that broke. So the split is not about where a test *can* live — it is about
making a failure point at its cause. The spec's job is only to prove the
building blocks are wired together and the journey a developer actually runs
works end to end.
