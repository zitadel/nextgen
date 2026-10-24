# ADR 079: Console Release Confidence — One Owner per Property, Three Gates

> **Status:** Proposed
> **Date:** 2026-10-24
> **Context:** The console ships with most merges, and every merge to `main`
> deploys the hosted cloud to production
> ([runbook](../runbooks/cloud.md#deploying)). What each test layer proves
> about a console change, which checks hold back a merge, a production
> deployment and a self-hosted release, and how a suite signs in on a
> deployment it did not boot.
> **Related:** [ADR 002](002-multi-package-release-strategy.md),
> [ADR 046](046-claim-lifecycle-v2.md),
> [ADR 053](053-cross-project-principals.md) §9,
> [ADR 075](075-platform-operators.md),
> [ADR 078](078-abuse-prevention-in-layers.md),
> [Console ADR 0004](../../apps/console/docs/adrs/0004-console-deployment-modes.md) §2,
> the layer rule in [`packages/testing/AGENTS.md`](../../packages/testing/AGENTS.md#which-layer-a-test-belongs-in)

## Context

### What runs today

- **The layer rule.** A property is tested at the lowest layer that proves it
  and never again above it: unit (Vitest in jsdom), browser (Vitest in
  Chromium), end to end (Playwright).
- **The console's route specs** run in jsdom over MSW. The console has no
  browser project, so below the end-to-end lanes nothing renders a console
  screen in a real browser.
- **The console lanes** ([`e2e/console`](../../e2e/console/README.md)) run in
  the required `full-pr` check whenever the console changes. Every write the
  console offers has a test against a real server there or in `e2e/journey`,
  and the admin grant's test checks that the colleague gains and loses access
  ([#2305](https://github.com/zitadel/nextgen/pull/2305)).
- **Every deployment** of the `cloud` project runs the console's deployment
  suite on its own URL, signed out: the routing, and the login widget's first
  step ([runbook](../runbooks/cloud.md#deployment-checks)).
- **The login atoms** are gated in Storybook on render and on accessibility:
  axe, where any violation fails
  ([`preview.ts`](../../apps/storybook/.storybook/preview.ts),
  `a11y: { test: "error" }`).

### What is missing

1. **Nothing signed in runs against a deployment.** The lanes boot a local
   server. The cloud's stack, Vercel's routing and functions in front of
   PlanetScale Postgres, is reached only signed out.
2. **What holds production back is a setting the repository does not record.**
   `production-checks.yml` reports `docs (Production)`,
   `console (Production)` and `schemas (Production)`. Vercel waits for them
   only once they are added as blocking Deployment Checks in the project's
   settings; until then a red status shows on a commit that is already
   serving.
3. **Accessibility and visual regressions in console screens pass every
   check.** No console screen runs axe, and nothing in the repository compares
   screenshots.
4. **The test kit has no credential for a deployment it did not boot.**
   `connectZitadel` takes the handle the kit's own boot wrote, and the
   platform automation principal the kit keeps `handle.platform` for does not
   exist (ADR 053 §9).

### Constraints

- The repository is public, so anyone signed in to GitHub can download a
  run's artifacts. A suite against a deployment uploads no traces and no HTML
  report (runbook).
- `deployment-checks.yml` runs on `deployment_status` with the file as it is
  on the deployed commit, and with the repository's secrets: a branch Vercel
  deploys can read every secret the suites hold.
- Test infrastructure gets its credentials from the kit's boot contract, never
  from a seed default, a server test mode or a database write (ADR 053 §9,
  Console ADR 0004 §2, the kit's
  [credential rules](../../packages/testing/AGENTS.md#credentials)).
- Every preview has a database of its own and imports the preview root admin:
  one login opens every preview (runbook).
- Merge-queue branches get no preview, so no deployment check can be required
  for a merge.

## Decision

### 1. One owner per property

| Property | Owner |
| --- | --- |
| Authorization semantics: who may do what | the Go suites ([authz testing](../design/api/authz-testing.md)) |
| One screen over the API's shapes: what it renders, its forms, its error states, where it navigates | the route specs, `apps/console/src/routes/**/*.spec.tsx` |
| What only a real browser shows about one screen: accessibility, layout | the console's browser specs (§4) |
| What the server decides about a console write: that it lands, that it persists, what it changes for another person | `e2e/console/src-real` without the platform project, `src-platform` with it |
| The path a customer's request takes: the embed base, the Go mux | `console-smoke`, `console-embedded` |
| Onboarding across the CLI, an app and the console | `e2e/journey` |
| The cloud: its routing and its stack, on the artifact Vercel built | the deployment suites (§2, §3) |

- A suite asserts only what no row above it can prove. A journey asserts only
  effects that cross surfaces or people, never one screen's behaviour again.
- A write the console adds lands with its test against a real server, in
  `e2e/console` or `e2e/journey`.

### 2. Three gates, and what only reports

| Gate | Held by |
| --- | --- |
| A merge to `main` | `full-pr`, the only required check: the build-and-test graph, then `e2e:all` whenever a lane is affected |
| The production domains | `docs (Production)`, `console (Production)` and `schemas (Production)`, blocking in the `cloud` project's Deployment Checks |
| A self-hosted release | the `full-pr` of every pull request it contains; the version PR packs and verifies the tarballs and runs no browser |

- The production setting becomes a requirement: the runbook lists it in the
  project's setup, not as an option.
- Force Promote stays the override for a check that is wrong, never for a
  deployment that is.
- A regression that reached the domains is answered with Instant Rollback,
  which expand/contract migrations keep safe (runbook).
- **Reported, never required:** the preview's deployment checks, the signed-in
  preview journey (§3) and visual review (§5). A red one is read on the pull
  request; none can hold the merge queue, which has no preview.

### 3. Signing in on a deployment

An admin journey runs against every preview, signed in, as a
`console journey (Preview)` job in `deployment-checks.yml`: an operator gives
a colleague admin and takes it away, and the colleague's own session gains and
loses the project, as `src-real` proves locally. Production stays signed out
and read-only: no test account and no writes there. What signs the suite in is
open.

#### A. The customer path, a fresh project per run (recommended)

Each run does what a new customer does, through the bypass header the suites
already send:

1. `createProject`, the anonymous operation `zitadel setup` calls, answers
   with the project and its secret. The kit builds its handle from that
   answer: the remote mode its README names `connectZitadel` as the base of.
2. The suite registers two fresh people at the console's sign-in screen, the
   operator and the colleague (`identity()` and `registerWithPassword`, as the
   journey's [claim suite](../../e2e/journey/src/claim.spec.ts) does).
3. The operator claims the project (`claim/init`, then `claim/complete` on the
   platform session, ADR 046) and runs the journey in it.

- **Secrets:** none beyond `VERCEL_AUTOMATION_BYPASS_SECRET`. The project
  secret and the session token are minted per run and masked as they are
  minted (`::add-mask::`).
- **Proves more than sign-in:** anonymous creation, sign-up and claim on the
  cloud's stack, on every preview.
- **Costs:** a project and two users per run in the branch's preview
  database, dropped with it. ADR 078 §2's per-address limit on
  `createProject` would apply to the runner; one call per run stays far below
  it. ADR 078 §5's Altcha is solvable by a script, by design. The edge's rules
  and Attack Mode have to let the suite's requests through.
- **To verify first:** that `createProject` answers through Deployment
  Protection with the bypass header, and that sign-up and claim are open on a
  preview.

#### B. The preview root admin as a repository secret

The suite signs in with the preview root admin's password.

- Works today, with nothing to build.
- That password opens every preview as its platform operator (ADR 075), over
  every project in it, and any branch with a deployment can read it.
- It is a seed credential used by test infrastructure, which ADR 053 §9 and
  the kit's credential rules exclude.

#### C. Wait for an automation principal

The PAT / service-user ADR that ADR 053 §9 defers would define a scoped key,
and the kit's `handle.platform` slot is where it would land.

- The right long-term shape: scoped, revocable, and nobody's password.
- Nothing signed in runs on a deployment until that ADR is written and built,
  and the key is still a standing secret every branch's workflow can read, so
  it would be minted on previews only.

A now. Once C exists it may replace the sign-up and claim steps, but the
journey through them stays worth running.

### 4. Accessibility

The bar is the login atoms': axe, where any violation fails. A violation the
gate finds on a screen that already ships is listed in one file the specs
read, with the rule, the screen and an issue; every entry needs one. Automated
checks are a floor: a screen's keyboard path stays asserted in its own tests.
Where the checks run is open.

#### A. A browser project for the console (recommended)

`*.browser.spec.ts` beside the route specs, run in Vitest's Chromium the way
`packages/components` runs its browser specs, over the same MSW handlers
through MSW's browser worker. Each screen is checked filled, empty and in its
error states.

- It is §1's row for the property: one screen, a real browser, no server.
- It reaches states real data rarely produces: an empty project, a failed
  read, a long list.
- It costs a second Vitest project in the console's config, and setting the
  shared handlers up for both projects instead of `msw/node`'s `setupServer`
  alone.

#### B. One sweep in an end-to-end lane

axe on every screen the platform lane's "reaches every management screen"
test already opens.

- Cheap: one helper and one loop.
- Only the states real data reaches, feedback only after a server build, and
  screen behaviour in a lane, which `e2e/console/AGENTS.md`'s first rule
  excludes.

Ruled out: axe in jsdom, which has no layout, so contrast and visibility
cannot be checked.

### 5. Visual review

Screenshots of console screens are compared with the base branch's on every
pull request that touches the console, and reviewed there. They never fail a
required check: an intended change moves them as surely as a regression does.
The tool is open.

#### A. Vitest screenshots over §4's fixtures (recommended, as a trial)

`toMatchScreenshot` in the browser project, with the reference images in the
repository.

- No third party, and the fixtures keep the screens deterministic.
- References are per platform, so they are rendered where CI renders them: a
  change to a screen updates them in a CI job, not on a laptop.
- Advisory only in a job outside `full-pr`, since a failing assertion inside
  it would block the merge.

#### B. A hosted comparison service

Argos, Percy and Chromatic are the common ones.

- A review screen with approval per image, and no images in the repository.
- A third party receives screenshots of test data, and its token is one more
  secret a branch's workflow can read.

A once §4 exists, on a few screens; B if reviewing references in the
repository turns out to be the bottleneck.

### 6. Out of scope

- Signed-in checks, test accounts or writes on production.
- Requiring any deployment check for a merge.
- A journey per screen, or one screen's behaviour asserted again in a journey.
- Where the console's client-side errors go: a privacy decision with an ADR of
  its own. The request IDs on error screens (ADR 076) already tie a report to
  the server's logs.
- The login surface's gates: Storybook, the demo lanes and the journey stay as
  they are.
- Canary and rolling releases: they limit how far a regression reaches, they
  do not find it.

## Recommended sequence

1. Add the three `(Production)` statuses to the `cloud` project's Deployment
   Checks (§2): a setting, no code.
2. The console's browser project, with axe and the exceptions file (§4).
3. Verify §3's first items, then build the kit's remote mode and the preview
   journey job, reporting only.
4. The screenshot trial (§5).

## Consequences

### Positive

- Every property has one owner, so a red check names its layer and nothing is
  proven twice.
- A red deployment no longer takes the production domains.
- The cloud's stack is checked signed in on every preview, with no new
  standing credential.
- A console screen's accessibility regressions fail the way an atom's do.

### Negative and risks

- Preview databases collect a project and two users per run until preview
  cleanup is automated; today it is by hand (runbook).
- The preview journey depends on anonymous creation, sign-up and claim staying
  open on previews. A change there turns it red on unrelated pull requests; it
  only reports, so that costs noise, not merges.
- A flaky production suite now delays a deployment instead of only reporting.
  It is run again from its run's page (runbook).
- The bypass secret stays readable by every branch Vercel deploys, as today.
- The browser project adds Chromium's start-up to the console's tests. axe may
  fail on markup the console takes from shadcn/ui and Radix; that goes in the
  exceptions file with an upstream issue.
- Screenshot references churn with every intended change, and reviewing them
  is work.

## Open questions

1. Does `createProject` answer through Deployment Protection with the bypass
   header, and are sign-up and claim open on previews (§3 A)?
2. Should the version PR run `console-embedded` against the binary the release
   publishes? Its console comes from `console:build-release`, not from the
   build every pull request tested.
3. axe's default rules, as Storybook runs them, or an explicit WCAG 2.2 AA tag
   list?
4. Does an entry in the exceptions file expire, and who removes it?

## Alternatives considered

- **A journey per admin task, across every screen.** It repeats the lanes'
  tests of each write, takes minutes, and fails without naming the screen.
  Rejected: one journey covers what crosses people (§1).
- **Requiring the preview checks.** They never report on merge-queue
  branches, so a required one would hold the queue for good.
- **A signed-in canary on production with a dedicated account.** A standing
  credential every branch's workflow can read, acting on production. Rejected
  for now.
- **Blocking on visual differences.** Intended changes fail them as often as
  regressions do.

## On acceptance

- `e2e/console/AGENTS.md`'s first rule names what the server decides about a
  console write beside the runtime boundaries, and gains the rule that a new
  write lands with its test (§1).
- The runbook's "Deployment checks" section makes the blocking setting part
  of the project's setup (§2).
- `e2e/console/README.md` lists the preview journey, and
  `packages/testing/README.md` the remote mode, when they land (§3).
