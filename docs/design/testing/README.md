# Test concept

> **Status:** Draft for team feedback.
> **Date:** 2026-10-13
> **Builds on:** the testing layers in [AGENTS.md](../../../AGENTS.md#testing-layers)
> (prove a property at the lowest layer that can see it) and the deployment
> checks in [the cloud runbook](../../runbooks/cloud.md#deployment-checks).

## What must never break

1. **A project can be created and used.** An agent runs `zitadel setup`, gets
   a project and an app that talks to it.
2. **Users can sign in.** They sign up, sign out and sign in again, with a
   password or with a passkey.
3. **A project can be claimed.** The developer opens the claim link and ends
   up owning the project in the console, signing up or signing in on the way.
4. **The docs work.** Pages, Markdown, search and the MCP server answer.

The focus now: product quality, getting a pull request to `main` fast and
safely, and the cloud's deployment and production checks before the cloud
launches.

## The model: surfaces, journeys, targets

Every test answers two questions: what does it cover, and where does it run.

- **Surface tests** check one part of the product through its own interface:
  the API, the login, the console, the CLI, the SDKs, the docs. Many, fast,
  on every pull request, owned by the team that owns the part. The testing
  layers in AGENTS.md pick the level.
- **Journeys** follow a person across parts. Few, written once, unaware of
  where they run. Labels say where each one may run: `smoke` for the short
  version production runs all the time, `cloud-only` for claiming an
  anonymous project, `needs-operator` for a step that signs an operator in.
- **Targets** are where the product runs: the local server the CLI starts,
  the cloud (a preview, production), later Docker Compose and Kubernetes. A
  target gets checks for what is unique to it (installing, upgrading,
  configuration, networking) and the journeys run against it, never a copy of
  the surface tests.

The CLI plays all three roles: a surface (its commands and their output), the
client a journey starts with (`zitadel setup`), and a target (the local
server `zitadel start` gives you). That is why it seemed to overlap with
everything.

Teams that ship one product to several places work the same way. GitLab's
end-to-end suite (GitLab QA) runs against any GitLab: a local Docker install,
a Kubernetes install from their Helm chart, staging, production; labels on
each test decide what runs where, and only a small smoke set runs on
production. Google keeps a short list of "critical user journeys" and probes
them in production all the time. Below both sit each part's own unit and
integration tests.

## Surfaces: product quality

| Surface | Tests today | Known gaps |
|---|---|---|
| Server and API | Go unit tests; integration tests on Postgres and SQLite on every pull request, Spanner nightly | the previous deployment's binary against the new schema; the server with a tiny connection pool under load |
| Login | Vitest unit and browser tests; the Storybook orchestrator workbench | |
| Console | Vitest; browser suites for the shell without a backend, against a real instance, for the console the binary serves, and for the platform project | |
| SDKs | unit tests per SDK; the Next and Nuxt demo apps against the mock, Next also against a real instance | |
| CLI | unit tests; command checks (`doctor`, `start`, `setup`) in the journey runner | |
| Docs | the docs suite, on the local build and on every cloud deployment | |
| Test kit | integration tests against a real instance | |

Performance has a harness ([`tools/bench`](../../../tools/bench/)) but
nothing runs it on a schedule.

## Journeys

Journeys 1–3 are [`apps/cli-journey-e2e`](../../../apps/cli-journey-e2e/),
which today runs on the local target only; journey 4 is the docs suite
([`apps/docs/tests`](../../../apps/docs/tests/)). Where the targets differ,
a journey branches on that one step instead of being written twice:

| Step | Local target | Cloud target |
|---|---|---|
| Server | `zitadel start` | the deployment's URL |
| Create the project | `zitadel setup --server local`: owned from setup | `zitadel setup --server <url>`: anonymous |
| Claim | `zitadel claim` reports "already claimed"; `zitadel console` signs the local admin in | the claim link, finished in the console: a new operator on a preview, the fixed test operator on production |
| Sign in | the same | the same |

All eight frameworks run locally. The frameworks differ on the client side and
the cloud differs in its environment, so against the cloud one framework per
way an app reaches the server is enough: Next.js (the SDK's middleware), Nuxt
(its server middleware), React (the Vite dev proxy React, Vue, Solid, Svelte
and Qwik share). That sampling catches real bugs: the dev proxies the CLI
scaffolds for the Vite frameworks and Angular cannot reach the cloud at all,
which no local test can see (fix in
[#1721](https://github.com/zitadel/nextgen/pull/1721)).

## From pull request to `main`

How a change gets in today:

1. **The pull request.** The required check `full-pr` runs what the change
   affects: [`ci-mode`](../../../scripts/ci-mode.mjs) and moon pick the
   lanes, and the journeys run locally on all frameworks when an SDK, the CLI
   or the journeys changed, on Next.js otherwise. Vercel builds a preview,
   and the deployment checks report on it.
2. **The merge queue.** `full-pr` runs again on the exact combination with the
   pull requests ahead in the queue, and only then the change merges, squashed.
   So `main` has always passed the gate.
3. **`main`** deploys to production through the production checks below.

**Fast.** `full-pr` takes about 9.5 minutes at the median (73 green runs,
2026-10-12/13): the moon step 211 s, the journeys 171 s, the release snapshot
42 s, the console's real-instance suite 39 s. In order:

- Take the Spanner lane out of the pull request graph. `--downstream deep`
  pulls it into `moon ci` on about three runs in four, where it alone takes
  over three minutes; the nightly run keeps it.
- Finish the switch to Turborepo: with the remote cache the graph step drops
  under 20 seconds when nothing it covers changed. Both run side by side now.
- What stays is the floor: the journeys and the real-instance suites, about
  four minutes, which no cache may replay. Under seven minutes at the median
  looks reachable. It counts twice: a change waits for one run on its pull
  request and one in the queue.

**Trustworthy.**

- Nothing that talks to a database is served from a cache (`cache: false`,
  `go test -count=1`): a cached "ok" once replayed a run that never happened.
- `ci-mode` fails open: a file no lane claims, an empty diff or a failed query
  forces a full run.
- A flaky test leaves the gate within a day, with an issue and an owner, and
  comes back fixed. A gate people re-run until it passes stops protecting
  anything.
- The preview's deployment checks are advice, not a gate: the queue does not
  build previews (`vercel.json` skips `gh-readonly-queue/**`), and a required
  check would wait for one forever. Queue a change only when its preview's
  checks are green.

## Deployment checks: every cloud deployment

|  | Preview | Production |
|---|---|---|
| Starts on | the `deployment_status` Vercel sends | `vercel.deployment.ready`, before the deployment gets the production domains |
| Runs | smoke, then journeys 1–3 with the **published** CLI (`npx @zitadel/cli@alpha`) on Next.js, Nuxt and React, and the docs | the same |
| Result | checks on the pull request | docs and smoke hold production now; the journeys report until launch, then hold production too |

- **Smoke** is a few HTTP calls (health, the console's runtime document, the
  login page, an API call without credentials that must get the server's own
  401). It names a service that is down within seconds, before a journey
  times out.
- **The published CLI**, because the cloud deploys on every merge while the
  CLI ships on the release train: in between, people run an older CLI against
  a newer cloud. Before launch this check only reports.
- **A failure says where to look:** a journey that fails on the cloud but not
  locally points at the environment; one that fails on both, at the code.

Test data and secrets:

- **Production.** A journey creates a new anonymous project per run, the
  product's own path. Claim uses **one fixed test operator** in production's
  platform project; its password lives in 1Password and in a GitHub
  environment secret that only the production check can read. Unclaimed
  projects pile up until a cleanup job exists, which
  [ADR 046](../../adrs/046-claim-lifecycle-v2.md) accepts.
- **Previews.** Every preview has a database of its own, so journeys sign up
  new operators there.
- **Names.** Everything a test creates is named `e2e-<run id>`, and test users
  get `@example.com` addresses, so a cleanup job can find them later.
- **Public artifacts.** The repository is public. Against a deployment there
  are no traces and no HTML report, only screenshots, and tokens minted at
  runtime are masked: the rule in
  [the runbook](../../runbooks/cloud.md#deployment-checks).
- **Vercel's protection.** Previews and deployment URLs sit behind Vercel
  Authentication. The browser gets the bypass cookie once; the CLI and the
  app's dev server get the bypass header from a preload that only tests load.
  The product does not change for it.

## Production checks: all the time

Every 15 minutes: smoke, then create a project and sign a user in, through
the test kit and the public domain users reach. No npm installs and no
scaffolded app on purpose: fewer moving parts, so a failure means
production, not the registry.

A failure that affects production goes to **incident.io**: this check, and a
production deployment check that only reports, because that deployment went
live anyway. A check that holds a deployment back is not an incident, since
the previous deployment keeps serving; it stays a GitHub check, like
everything on previews. The workflow raises the alert through an incident.io
HTTP alert source, whose token is a GitHub secret, and resolves it once the
check passes again.

## Releases

- **The CLI and the SDKs.** After npm publish, the new CLI runs journeys 1–3
  against production and the local binary. Today nothing checks a release
  after it is published: the pull request lane tests the packed packages, not
  what npm serves.
- **The container image.** The Docker Compose check below.

## Before the cloud launches

- [ ] The journeys hold production deployments, not only docs and smoke.
- [ ] The 15-minute check runs and alerts in incident.io, and someone
      receives the alert.
- [ ] The fixed test operator exists, with its password in 1Password and the
      GitHub environment secret.
- [ ] A rollback has been practised once: Vercel's Instant Rollback onto a
      schema the newer deployment already migrated.
- [ ] The server refuses a CLI that is too old with a clear message. From
      then on, a deployment must keep the published CLI working.
- [ ] Everything tests create follows the naming rule, so cleanup can find it.

## Self-hosting targets

### Docker Compose

The self-hosting setup in
[`docs/operations/docker-compose.yaml`](../../operations/docker-compose.yaml)
is documented for customers, and nothing tests it. One check per release
covers it: start it with the published image, run the journeys, upgrade from
the previous image, run them again.

### Kubernetes: to think through, not to build yet

There is no Helm chart or manifest yet, so there is nothing to test. The
cloud already exercises part of what Kubernetes stresses: many server
instances at once, a connection budget shared between them, old and new
versions on one schema during a rollout. What only Kubernetes adds, and what
a chart has to get right:

- **Readiness.** `/readyz` answers "ok" without touching the database, so
  Kubernetes would send traffic to a pod that cannot reach it.
- **Migrations.** A Job or an init container, run once per upgrade, before new
  pods take traffic.
- **Shutdown.** Finishing in-flight requests when a pod is told to stop.
- **Configuration.** The master key and the database URL as Kubernetes
  Secrets.
- **Connections.** Pool size times replicas within Postgres' connection limit.
- **Ingress and TLS.** The `X-Forwarded-*` headers the server trusts.

Once a chart exists, the usual test is a throwaway cluster in CI (kind, with
chart-testing): install, run the journeys, upgrade from the previous chart
version, run them again. Nightly or per release, not on every pull request.

## Later: other dimensions

1. **Schema changes.** The previous deployment's binary against the new
   schema. Expand/contract migrations are a rule today, not a test.
2. **Resilience.** A Go integration test with a tiny connection pool under
   concurrent requests: the cloud's one real incident so far.
3. **Self-hosted upgrades.** Data written by version N-1, migrated by N, then
   N's tests, nightly.
4. **Performance.** `tools/bench` on a schedule, with a threshold.

## Rollout

1. A faster gate: the Spanner lane out of the pull request graph, then the
   switch to Turborepo.
2. Journeys against previews: the runner learns `--server <url>`,
   `--cli published` and Vercel's bypass; Next.js first, reporting only. The
   smoke job in front.
3. Claim on the cloud, with the fixed production operator.
4. The 15-minute check, with its incident.io alert source.
5. The launch checklist; the journeys start holding production.
6. The release lane.
7. The Docker Compose check; Kubernetes once a chart exists.

## Open questions

- When does the cloud launch, so the journeys start holding production?
- Should the merge queue build previews, so the deployment checks can block a
  merge? It costs a preview build and a preview database per queue entry,
  and the queue would wait for both.
- Is Angular a family of its own on the cloud?
