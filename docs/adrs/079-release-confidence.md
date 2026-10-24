# ADR 079: Release Confidence — One Owner per Property, a Suite per Service, Three Gates

> **Status:** Proposed
> **Date:** 2026-10-24
> **Context:** The hosted cloud is one Vercel deployment of six services built
> from one commit, and every merge to `main` deploys it to production
> ([runbook](../runbooks/cloud.md#layout)). The console ships with most of
> those merges. What each test layer proves about a change, what each service
> of a deployment is checked for, which checks hold back a merge, a production
> deployment and a self-hosted release, what the server's health endpoints
> mean, and how a suite signs in on a deployment it did not boot.
> **Related:** [ADR 002](002-multi-package-release-strategy.md),
> [ADR 046](046-claim-lifecycle-v2.md),
> [ADR 048](048-wide-events-internal-audit-primitive.md),
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
  `a11y: { test: "error" }`). The gate runs in CI, not on the deployed
  storybook.
- **The health endpoints.** `/healthz`, `/livez` and `/readyz` answer `ok`
  without touching the database ([`health.go`](../../internal/api/health.go)),
  and the spec lists their `fail` under `200`. The CLI's `start`, `doctor`
  and `setup`, the test kit, the benchmark harness and the console's System
  screen read `/healthz`; orchestrators look for all three at the root
  (ADR 077).
- **Between deployments** nothing runs against production, and nothing pages
  anyone.

### What is missing

1. **Half of the deployment has no suite of its own.** The server is reached
   only through the console's suite, which makes no call with a credential.
   The website and the storybook have none: nothing loads `/`, `/changelog`,
   the favicons the other services link, or the storybook.
2. **Nothing signed in runs against a deployment.** The lanes boot a local
   server. The cloud's stack, Vercel in front of PlanetScale Postgres, is
   reached only signed out.
3. **What holds production back is a setting the repository does not record.**
   `production-checks.yml` reports `docs (Production)`,
   `console (Production)` and `schemas (Production)`. Vercel waits for them
   only once they are added as blocking Deployment Checks in the project's
   settings; until then a red status shows on a commit that is already
   serving.
4. **No endpoint says whether the server works.** All three health endpoints
   answer `ok` with the database down, so a check that reads one proves only
   that the process started.
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
- Test infrastructure gets its credentials from the kit's boot contract, never
  from a seed default, a server test mode or a database write (ADR 053 §9,
  Console ADR 0004 §2, the kit's
  [credential rules](../../packages/testing/AGENTS.md#credentials)).
- Every preview has a database of its own and imports the preview root admin:
  one login opens every preview (runbook).
- Merge-queue branches get no preview, so no deployment check can be required
  for a merge.
- Released CLIs read `/healthz`: `start` waits on it, and `doctor` and
  `setup` probe it.

## Decision

### 1. One owner per property

| Property | Owner |
| --- | --- |
| Authorization semantics: who may do what | the Go suites ([authz testing](../design/api/authz-testing.md)) |
| One console screen over the API's shapes: what it renders, its forms, its error states, where it navigates | the route specs, `apps/console/src/routes/**/*.spec.tsx` |
| What only a real browser shows about one console screen: accessibility, layout | the console's browser specs (§6) |
| What the server decides about a console write: that it lands, that it persists, what it changes for another person | `e2e/console/src-real` without the platform project, `src-platform` with it |
| The path a request takes to a self-hosted server: the embed base, the Go mux | `console-smoke`, `console-embedded` |
| Onboarding across the CLI, an app and the console | `e2e/journey` |
| A service of the cloud, on the artifact Vercel built: its paths and what they need behind them | that service's deployment suite (§2) |

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
| `server` | New: `/readyz`, which covers the database (§5); the not-found answer, a page for a browser and the envelope for a program, which moves here from the console's suite; on a preview, signed in through §4, a round trip with the project's secret. |
| `console` | As today, and on a preview the admin journey, signed in (§4). |
| `docs` | As today. |
| `schemas` | As today. |
| `website` | New: `/` and `/changelog` render, with the releases GitHub's API returns, and log no errors; `/llms.txt`; `/favicon.ico` and `/favicons/*`, which the other services link. |
| `storybook` | New: it replies. `/storybook/` answers with its index; nothing more. Its mock service worker needs no check of its own: it loads from `/storybook/`, and the browser keeps a worker inside the path its script comes from. |

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
  run signed in (§4), and visual review (§7). A red one is read on the pull
  request; none can hold the merge queue, which has no preview.

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

### 5. Two probes: alive and ready

An orchestrator asks two questions apart: whether to restart a process, and
whether to send it requests. One endpoint answers each, and `/healthz`, a
third name for the first, goes at 1.0.0.

| Endpoint | Answers | Checks |
| --- | --- | --- |
| `/livez` | `200 ok` while the process serves HTTP | nothing behind it: a liveness probe that checked the database would restart every instance when the database blips |
| `/readyz` | `200 ok` when the server can serve requests, `503 fail` when it cannot | that the database answers, within a short timeout |
| `/healthz` | as today, with a `Deprecation` header, until 1.0.0 | what `/livez` checks, so released CLIs keep finding a server that is up |

- **The fix:** `/readyz` checks the database and answers `503 fail` when it
  cannot reach it, `/livez` keeps checking nothing, and the spec documents
  `fail` under `503` instead of `200`. The change ships with a
  `@zitadel/server` changeset.
- **The readers move to the meaning they want:** the CLI's `start`, `doctor`
  and `setup`, the test kit's wait and the benchmark harness wait for
  `/readyz`, so a wait covers the database too; the console's System screen
  reads it; the README and the quick start name `/livez` and `/readyz`.
- **`/healthz` stays until 1.0.0,** as ADR 077 keeps the old root paths, and
  answers as `/livez` does: a released CLI that probes it keeps working, and a
  liveness probe someone pointed at it never starts restarting instances.
- **A probe stays cheap:** one round trip on the pool, bounded by its
  timeout. Probes are skipped by the request events (ADR 048).
- **On the cloud nothing probes the function.** `/readyz` there serves the
  server's suite (§2), and whatever watches production later (§8).

### 6. Accessibility

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

### 7. Visual review

Screenshots of console screens are compared with the base branch's on every
pull request that touches the console, and reviewed there. They never fail a
required check: an intended change moves them as surely as a regression does.
The tool is open.

#### A. Vitest screenshots over §6's fixtures (recommended, as a trial)

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

A once §6 exists, on a few screens; B if reviewing references in the
repository turns out to be the bottleneck.

### 8. Out of scope, and deferred

- **Deferred: watching production between deployments.** Nothing runs
  against production between deployments, and nothing pages anyone; the
  changelog reads GitHub's API at runtime, the database is PlanetScale's and
  telemetry goes on to Mixpanel's, so production can break without a
  deployment. A later decision takes it up, starting from §2's suites and
  §5's `/readyz`.
- Signed-in checks, test accounts or writes on production.
- Requiring any deployment check for a merge.
- A journey per screen, or one screen's behaviour asserted again in a journey.
- Where the console's client-side errors go: a privacy decision with an ADR of
  its own. The request IDs on error screens (ADR 076) already tie a report to
  the server's logs.
- The login atoms' gates: Storybook's CI run, the demo lanes and the journey
  stay as they are.
- Load and performance, which the benchmark harness owns (ADR 067).
- Monitoring a self-hosted deployment, which is its operator's; §5 only
  decides what the server's endpoints say.
- Canary and rolling releases: they limit how far a regression reaches, they
  do not find it.

## Recommended sequence

1. Add the three existing `(Production)` statuses to the `cloud` project's
   Deployment Checks (§3): a setting, no code.
2. The probes (§5): `/readyz` checks the database, the repository's readers
   move to it, and `/healthz` gets its `Deprecation` header.
3. The server, website and storybook suites (§2), each joining the production
   checks as it lands.
4. The console's browser project, with axe and the exceptions file (§6).
5. Verify §4's first items, then build the kit's remote mode, the preview
   journey and the server suite's signed-in round trip.
6. The screenshot trial (§7).

## Consequences

### Positive

- Every property has one owner, so a red check names its layer or its service,
  and nothing is proven twice.
- Every service of a deployment is checked before the deployment takes the
  production domains, and a red one no longer takes them.
- A server that cannot reach its database says so: to the deployment suites,
  to the CLI and the test kit as they wait, and to a self-hoster's
  orchestrator.
- The cloud's stack is checked signed in on every preview, with no new
  standing credential.
- A console screen's accessibility regressions fail the way an atom's do.

### Negative and risks

- Production waits on six suites, so a flaky one delays a deployment; it is
  run again from its run's page (runbook). The storybook's only asks that it
  replies, which a built static site rarely fails.
- A self-hosted readiness probe on `/readyz` takes every instance out of its
  load balancer while the database is down, the requests that need no
  database with them. Nearly every request needs it anyway.
- Preview databases collect a project and two users per run until preview
  cleanup is automated; today it is by hand (runbook).
- The preview journey depends on anonymous creation, sign-up and claim staying
  open on previews. A change there turns it red on unrelated pull requests; it
  only reports, so that costs noise, not merges.
- The bypass secret stays readable by every branch Vercel deploys, as today.
- The browser project adds Chromium's start-up to the console's tests. axe may
  fail on markup the console takes from shadcn/ui and Radix; that goes in the
  exceptions file with an upstream issue.
- Screenshot references churn with every intended change, and reviewing them
  is work.

## Open questions

1. Does `createProject` answer through Deployment Protection with the bypass
   header, and are sign-up and claim open on previews (§4 A)?
2. Is the storybook part of the cloud for customers, curated to the login's
   customization surface and linked from the docs, or a team tool that leaves
   the production deployment? Its suite and its status follow the answer.
3. Does `/readyz` also check that the schema is migrated as far as the binary
   needs (§5)?
4. Should the version PR run `console-embedded` against the binary the release
   publishes? Its console comes from `console:build-release`, not from the
   build every pull request tested.
5. axe's default rules, as Storybook runs them, or an explicit WCAG 2.2 AA tag
   list?
6. Does an entry in the exceptions file expire, and who removes it?

## Alternatives considered

- **One suite for the whole bundle.** A red check would not say which service
  broke, and a path would have two homes. Rejected: a suite per service (§2).
- **One health endpoint that checks everything.** A liveness probe on it
  would restart every instance whenever the database blips. Rejected: two
  probes (§5).
- **Removing `/healthz` now.** Released CLIs probe it. Rejected: it stays,
  deprecated, until 1.0.0 (§5).
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
  part of the project's setup (§3).
- `e2e/console/README.md` lists the preview journey, and
  `packages/testing/README.md` the remote mode, when they land (§4).
