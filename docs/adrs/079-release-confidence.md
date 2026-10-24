# ADR 079: Release Confidence — One Owner per Property, a Suite per Service, Three Gates

> **Status:** Proposed
> **Date:** 2026-10-24
> **Context:** The hosted cloud is one Vercel deployment of six services built
> from one commit, and every merge to `main` deploys it to production
> ([runbook](../runbooks/cloud.md#layout)). The console ships with most of
> those merges. What each test layer proves about a change, what each service
> of a deployment is checked for, which checks hold back a merge, a production
> deployment and a self-hosted release, what says production is still up
> between deployments, and how a suite signs in on a deployment it did not
> boot.
> **Related:** [ADR 002](002-multi-package-release-strategy.md),
> [ADR 046](046-claim-lifecycle-v2.md),
> [ADR 053](053-cross-project-principals.md) §9,
> [ADR 067](067-benchmark-harness-http-path-ownership.md),
> [ADR 075](075-platform-operators.md),
> [ADR 076](076-error-pages-and-unmatched-routes.md),
> [ADR 077](077-api-path-prefix.md),
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
- **The deployment suites.** Every deployment of the `cloud` project runs
  three suites on its own URL
  ([runbook](../runbooks/cloud.md#deployment-checks)): the docs' (their pages,
  each page's Markdown, search, the MCP server), the schemas' (every built-in
  schema against the deployed commit's rendering) and the console's, signed
  out (its routing, the Mixpanel rewrite, the server's not-found answer and
  the login widget's first step).
- **The login atoms** are gated in Storybook on render and on accessibility:
  axe, where any violation fails
  ([`preview.ts`](../../apps/storybook/.storybook/preview.ts),
  `a11y: { test: "error" }`).
- **The health endpoints.** `/healthz`, `/livez` and `/readyz` answer `ok`
  without touching the database ([`health.go`](../../internal/api/health.go)).
  The CLI's `start`, `doctor` and `setup`, the test kit and the benchmark
  harness wait on or probe `/healthz`; orchestrators look for all three at
  the root (ADR 077).
- **Between deployments** nothing runs against production, and nothing pages
  anyone. The repository's scheduled workflows are the scaffold advisories
  and the Spanner lane.

### What is missing

1. **Half of the deployment has no suite of its own.** The server is reached
   only through the console's suite, which never opens the login UI at
   `/ui/login/` or makes a call with a credential. The website and the
   storybook have none: nothing loads `/`, `/changelog` or the favicons the
   console, the login UI and the docs link, and nothing checks that the
   storybook's service worker stays out of the other services' paths.
2. **Nothing signed in runs against a deployment.** The lanes boot a local
   server. The cloud's stack, Vercel in front of PlanetScale Postgres, is
   reached only signed out.
3. **What holds production back is a setting the repository does not record.**
   `production-checks.yml` reports `docs (Production)`,
   `console (Production)` and `schemas (Production)`. Vercel waits for them
   only once they are added as blocking Deployment Checks in the project's
   settings; until then a red status shows on a commit that is already
   serving.
4. **Production can break between deployments and nobody hears of it.** The
   changelog rebuilds from GitHub's API at most every fifteen minutes, the
   database is PlanetScale's and telemetry goes on to Mixpanel's API: any of
   them can fail with no deployment, and only a user notices.
5. **Accessibility and visual regressions in console screens pass every
   check.** No console screen runs axe, and nothing in the repository compares
   screenshots.
6. **The test kit has no credential for a deployment it did not boot.**
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
- The production domain is public. Any other URL of the project, a preview's
  or a deployment's own, needs the bypass secret (runbook).
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
| One console screen over the API's shapes: what it renders, its forms, its error states, where it navigates | the route specs, `apps/console/src/routes/**/*.spec.tsx` |
| What only a real browser shows about one console screen: accessibility, layout | the console's browser specs (§7) |
| What the server decides about a console write: that it lands, that it persists, what it changes for another person | `e2e/console/src-real` without the platform project, `src-platform` with it |
| The path a request takes to a self-hosted server: the embed base, the Go mux | `console-smoke`, `console-embedded` |
| Onboarding across the CLI, an app and the console | `e2e/journey` |
| A service of the cloud, on the artifact Vercel built: its paths and what they need behind them | that service's deployment suite (§2) |
| Production between deployments | the scheduled run (§5) |

- A suite asserts only what no row above it can prove. A journey asserts only
  effects that cross surfaces or people, never one screen's behaviour again.
- A write the console adds lands with its test against a real server, in
  `e2e/console` or `e2e/journey`.

### 2. A deployment suite per service

Every service of the deployment has one suite, run on the deployment's own
URL. A suite pins the paths its service serves and what they need behind
them, and a path is pinned by the suite of the service that serves it,
wherever it is linked from. Adding one is what the runbook already describes:
a turbo task `check:cloud` lists, a job in `deployment-checks.yml` and a
status in `production-checks.yml`'s `SUITES`.

| Service | Its suite pins |
| --- | --- |
| `server` | New: `/healthz`; the login UI at `/ui/login/` rendering and starting a sign-in; the not-found answer, a page for a browser and the envelope for a program, which moves here from the console's suite; on a preview, signed in through §4, a round trip with the project's secret. |
| `console` | As today, and on a preview the admin journey, signed in (§4). |
| `docs` | As today. |
| `schemas` | As today. |
| `website` | New: `/` and `/changelog` render, with the releases GitHub's API returns, and log no errors; `/llms.txt`; `/favicon.ico` and `/favicons/*`, which the console, the login UI and the docs link. |
| `storybook` | New: `/storybook/` renders a story, and its service worker is scoped to `/storybook/`, so after a visit the console's and the login UI's requests still reach the server. |

- `/telemetry/mixpanel/*` belongs to no service; its check stays in the
  console's suite.
- Against production a suite stays signed out and goes no further into a
  sign-in than its first step, as the console's does today. What signs in
  runs on previews only (§4).
- A suite keeps the deployment rules: no traces, no HTML report, screenshots
  only (runbook).

### 3. Three gates, and what only reports

| Gate | Held by |
| --- | --- |
| A merge to `main` | `full-pr`, the only required check: the build-and-test graph, then `e2e:all` whenever a lane is affected |
| The production domains | every service's `(Production)` status, for `server`, `console`, `storybook`, `docs`, `website` and `schemas`, blocking in the `cloud` project's Deployment Checks |
| A self-hosted release | the `full-pr` of every pull request it contains; the version PR packs and verifies the tarballs and runs no browser |

- The production setting becomes a requirement: the runbook lists the
  statuses in the project's setup, not as an option, and a suite's status
  joins them when the suite lands.
- Force Promote stays the override for a check that is wrong, never for a
  deployment that is.
- A regression that reached the domains is answered with Instant Rollback,
  which expand/contract migrations keep safe (runbook).
- **Reported, never required:** the preview's deployment checks and what they
  run signed in (§4), and visual review (§8). A red one is read on the pull
  request; none can hold the merge queue, which has no preview. The scheduled
  run (§5) alerts instead.

### 4. Signing in on a deployment

Two things run signed in against every preview: the console's admin journey,
as a `console journey (Preview)` job in `deployment-checks.yml` (an operator
gives a colleague admin and takes it away, and the colleague's own session
gains and loses the project, as `src-real` proves locally), and the server
suite's round trip with a project's secret. Production stays signed out and
read-only: no test account and no writes there. What signs the suites in is
open.

#### A. The customer path, a fresh project per run (recommended)

Each run does what a new customer does, through the bypass header the suites
already send:

1. `createProject`, the anonymous operation `zitadel setup` calls, answers
   with the project and its secret. The kit builds its handle from that
   answer: the remote mode its README names `connectZitadel` as the base of.
   The server suite's round trip uses the same secret.
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

### 5. Production between deployments

The production part of every deployment suite (§2) runs again on a schedule
against the production domain, which is public, so the run needs no secret to
reach it. A red run is retried once, then alerts whoever is on call for the
cloud. The proposed interval is ten minutes. How it runs is open.

#### A. A scheduled GitHub workflow (recommended to start)

`check:cloud` against the production domain from a workflow on a `schedule`,
posting to the on-call tool when it fails.

- It reuses the suites as they are, on hosted runners that cost a public
  repository nothing.
- GitHub starts scheduled runs late under load and may drop one, and five
  minutes is its shortest interval.
- The alert's webhook is one more repository secret, readable like the others
  by any branch's workflow; one that can only open an alert is worth little
  to anyone else.

#### B. A synthetic monitoring service

A service that runs Playwright checks on a schedule from several regions and
routes the alerts itself; Checkly is the common one beside Vercel.

- Steady intervals, several regions, and alert routing without a webhook of
  ours.
- Another vendor and bill, and the suites have to run in its runtime, outside
  turbo and the repository's Playwright pin.

#### C. An uptime pinger

One URL, requested every minute or more often.

- The cheapest, with the shortest interval.
- Only as good as its URL: today's health endpoints answer `ok` with the
  database down (§6).

A now; B if GitHub's schedule proves too late or too noisy; C beside either,
once §6 gives it a URL worth pinging. Alerts on the server function's errors,
from its runtime logs through a log drain (runbook), see what users run into;
the schedule sees what nobody happened to request. Neither replaces the other.

### 6. A health endpoint that means "up"

`/healthz`, `/livez` and `/readyz` answer `ok` from a process that cannot
reach its database. That is right for liveness and wrong for anything that
asks whether the service works. Which endpoint says that is open.

#### A. `/readyz` checks the database

A ping with a short timeout, and `fail` when it does not answer. `/healthz`
and `/livez` stay as they are, so the CLI's, the kit's and the benchmarks'
waits do not change.

- The probe orchestrators already read starts to mean what its name says.
- When the database blips, every instance leaves the load balancer at once,
  so requests that need no database fail too; and every probe holds one of
  an instance's pooled connections (four through PlanetScale's PgBouncer on
  the cloud, runbook).

#### B. A separate check for monitors (recommended)

A new unauthenticated operation that checks the database and whatever else a
request needs, for monitors and §5 C. The three probes stay as they are.

- No orchestrator behaves differently, and a monitor gets a URL that means
  the service works.
- One more public operation that does work per request: it falls under the
  edge's per-address limit (ADR 078 §2) and says nothing about the
  deployment beyond up or down.

#### C. Leave them

Monitors make a request that needs the database, as the console's suite does
with the login widget's first step.

- Nothing to build.
- Every monitor picks its own request, and none of them is the server's own
  statement about itself.

### 7. Accessibility

The bar is the login atoms': axe, where any violation fails. A violation the
gate finds on a console screen that already ships is listed in one file the
specs read, with the rule, the screen and an issue; every entry needs one.
Automated checks are a floor: a screen's keyboard path stays asserted in its
own tests. Where the checks run is open.

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

### 8. Visual review

Screenshots of console screens are compared with the base branch's on every
pull request that touches the console, and reviewed there. They never fail a
required check: an intended change moves them as surely as a regression does.
The tool is open.

#### A. Vitest screenshots over §7's fixtures (recommended, as a trial)

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

A once §7 exists, on a few screens; B if reviewing references in the
repository turns out to be the bottleneck.

### 9. Out of scope

- Signed-in checks, test accounts or writes on production.
- Requiring any deployment check for a merge.
- A journey per screen, or one screen's behaviour asserted again in a journey.
- Where the console's client-side errors go: a privacy decision with an ADR of
  its own. The request IDs on error screens (ADR 076) already tie a report to
  the server's logs.
- The login atoms' gates: Storybook, the demo lanes and the journey stay as
  they are.
- Load and performance, which the benchmark harness owns (ADR 067).
- Monitoring a self-hosted deployment, which is its operator's; §6 only
  decides what the server's endpoints say.
- Canary and rolling releases: they limit how far a regression reaches, they
  do not find it.

## Recommended sequence

1. Add the three existing `(Production)` statuses to the `cloud` project's
   Deployment Checks (§3): a setting, no code.
2. The server, website and storybook suites (§2), each joining the production
   checks as it lands.
3. The scheduled run and its alert route (§5).
4. The console's browser project, with axe and the exceptions file (§7).
5. Verify §4's first items, then build the kit's remote mode, the preview
   journey and the server suite's signed-in round trip.
6. The screenshot trial (§8), and §6 once whoever runs self-hosted
   deployments has weighed in.

## Consequences

### Positive

- Every property has one owner, so a red check names its layer or its service,
  and nothing is proven twice.
- Every service of a deployment is checked before the deployment takes the
  production domains, and a red one no longer takes them.
- Someone hears of production breaking between deployments before a user
  reports it.
- The cloud's stack is checked signed in on every preview, with no new
  standing credential.
- A console screen's accessibility regressions fail the way an atom's do.

### Negative and risks

- Production waits on six suites, so a flaky one delays a deployment; it is
  run again from its run's page (runbook). The storybook, a workbench, can
  hold back a fix to the server.
- The scheduled run can page for GitHub's or the runner's trouble rather than
  production's; the retry narrows that, it does not remove it. Each run's
  sign-in first step reaches production as a visitor's would.
- Preview databases collect a project and two users per run until preview
  cleanup is automated; today it is by hand (runbook).
- The preview journey depends on anonymous creation, sign-up and claim staying
  open on previews. A change there turns it red on unrelated pull requests; it
  only reports, so that costs noise, not merges.
- The bypass secret stays readable by every branch Vercel deploys, as today,
  and the alert webhook joins it.
- The browser project adds Chromium's start-up to the console's tests. axe may
  fail on markup the console takes from shadcn/ui and Radix; that goes in the
  exceptions file with an upstream issue.
- Screenshot references churn with every intended change, and reviewing them
  is work.

## Open questions

1. Does `createProject` answer through Deployment Protection with the bypass
   header, and are sign-up and claim open on previews (§4 A)?
2. Where do the cloud's alerts go, and who is on call for it (§5)?
3. Is §6 B what self-hosted operators want, or do their orchestrators need A?
4. Should the version PR run `console-embedded` against the binary the release
   publishes? Its console comes from `console:build-release`, not from the
   build every pull request tested.
5. axe's default rules, as Storybook runs them, or an explicit WCAG 2.2 AA tag
   list?
6. Does an entry in the exceptions file expire, and who removes it?

## Alternatives considered

- **One suite for the whole bundle.** A red check would not say which service
  broke, and a path would have two homes. Rejected: a suite per service (§2).
- **Deployment checks alone, no schedule.** They run once per deployment, and
  the bundle depends on services that change without one. Rejected (§5).
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
- The runbook's "Deployment checks" section lists every service's status as
  part of the project's setup and describes the scheduled run (§3, §5); its
  "Operating" section names the alert route.
- `e2e/console/README.md` lists the preview journey, and
  `packages/testing/README.md` the remote mode, when they land (§4).
