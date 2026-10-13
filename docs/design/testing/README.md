# Test concept: CLI and cloud

> **Status:** Draft for team feedback.
> **Date:** 2026-10-12
> **Builds on:** the testing layers in [AGENTS.md](../../../AGENTS.md#testing-layers)
> (prove a property at the lowest layer that can see it) and the deployment
> checks in [the cloud runbook](../../runbooks/cloud.md#deployment-checks).

## What must never break

Four things decide whether the product works for someone:

1. **A project can be created and used.** An agent runs `zitadel setup`, gets
   a project and an app that talks to it.
2. **Users can sign in.** They sign up, sign out and sign in again, with a
   password or with a passkey.
3. **A project can be claimed.** The developer opens the claim link and ends
   up owning the project in the console, signing up or signing in on the way.
4. **The docs work.** Pages, Markdown, search and the MCP server answer.

We ship them two ways: the **CLI** with a local server, and the **cloud**.
The two overlap almost completely: the same CLI creates projects on either,
and the same login and console run on both. They differ in three places:

- the cloud is reached over HTTPS, through Vercel;
- a cloud project is anonymous until someone claims it, while a local one is
  owned from setup;
- only the cloud serves the docs.

## The idea

**Write each journey once, run it against more than one target.** A journey
is a path a person takes; a target is where it runs: the local binary, a
cloud preview, cloud production, later a self-hosted Docker install. Where
the targets really differ, the journey branches on that one step instead of
being written twice:

| Step | Local target | Cloud target |
|---|---|---|
| Server | `zitadel start` | the deployment's URL |
| Create the project | `zitadel setup --server local`: owned from setup | `zitadel setup --server <url>`: anonymous |
| Claim | `zitadel claim` reports "already claimed"; `zitadel console` signs the local admin in | the claim link, finished in the console: a new operator on a preview, the fixed test operator on production |
| Sign in | the same | the same |

**Each half is tested against the other half's live version.** The cloud
deploys on every merge; the CLI and SDKs ship on the release train. In
between, people run an older CLI against a newer cloud, or a new CLI against
today's cloud. So a cloud deployment is tested with the **published** CLI
(`npx @zitadel/cli@alpha`), and a CLI release is tested against the
**production** cloud. While the cloud is not live, these checks report
instead of blocking.

**Breadth where it is cheap, depth where it is real.** The eight frameworks
differ on the client side; the cloud differs in its environment. All
frameworks and presets run locally on every pull request. Against the cloud,
one framework per way an app reaches the server is enough:

- Next.js: the SDK's middleware;
- Nuxt: its server middleware;
- React: the Vite dev proxy, which React, Vue, Solid, Svelte and Qwik share.

That sampling catches real bugs: today the Vite dev proxy the CLI scaffolds
([vite-support.ts](../../../apps/cli/src/lib/orca/patchers/rule/vite-support.ts))
cannot reach the cloud. It keeps `localhost` as the host name, so the TLS
handshake with Vercel fails. Locally, where everything is `localhost`, nothing
shows it.

**A failure says where to look.** A short smoke pass runs first and names a
service that is down within seconds, before any journey times out. And the
same journey on two targets separates the code (fails on both) from the
environment (fails on the cloud only).

## When what runs

| When | CLI and SDKs | Server | Frameworks | What runs | Result |
|---|---|---|---|---|---|
| Pull request | this commit, packed, from a private registry | this commit, local binary | all 8, every preset | journeys 1–3 | the required check `full-pr` (exists) |
| Preview deployment | published `@alpha` | the preview | Next, Nuxt, React | smoke, journeys 1–4 | checks on the pull request |
| Production deployment | published `@alpha` | the new deployment, before it gets the production domains | Next, Nuxt, React | smoke, journeys 1–4 | docs and smoke hold production; journeys report until the cloud is live |
| CLI release | the new version, from npm | production cloud and the local binary | Next, Nuxt, React | journeys 1–3 | reported on the release |
| Every 15 minutes | the test kit only | production | none | smoke, then create a project and sign a user in, without scaffolding an app | an alert in incident.io |

- Journey 4 is the existing docs suite ([apps/docs/tests](../../../apps/docs/tests/)).
- Nothing tests a release after it is published today: the pull request lane
  tests the packed packages, not what npm serves.
- The 15-minute run leaves out npm installs and app scaffolds on purpose:
  fewer moving parts, so an alert means production, not the registry.

## Alerts

A failure that affects production goes to **incident.io**: the 15-minute
check, and a production check that only reports, because that deployment
went live anyway. A check that holds a deployment back is not an incident,
since the previous deployment keeps serving: it stays a GitHub check, like
everything on previews. The workflow raises the alert through an incident.io
HTTP alert source, whose token is a GitHub secret, and resolves it once the
check passes again.

## Test data and secrets

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

## Where the code lives

- [`apps/cli-journey-e2e`](../../../apps/cli-journey-e2e/): the journeys.
  New: `--server <url>` (skip `zitadel start`, pass the URL to `setup`),
  `--cli published` (`npx` from npm instead of the private registry), and a
  target the specs ask what to expect. Its purpose in AGENTS.md grows from
  "the customer local setup path" to the customer setup path, local and
  cloud.
- [`apps/docs/tests`](../../../apps/docs/tests/): unchanged.
- Smoke: a few HTTP calls (health, the console's runtime document, the login
  page, an API call without credentials that must get the server's own 401),
  a job of its own in front of the journeys.
- Workflows: [`deployment-checks.yml`](../../../.github/workflows/deployment-checks.yml)
  gains `smoke` and `journeys` jobs beside `docs`;
  [`production-checks.yml`](../../../.github/workflows/production-checks.yml)
  reports them; a scheduled workflow runs the 15-minute check; and
  [`release-publish.yml`](../../../.github/workflows/release-publish.yml)
  gains a job after publishing.

## Rollout

1. The journey runner against a URL (`--server`, `--cli published`, Vercel's
   bypass); Next.js against previews, reporting only.
2. Claim on the cloud target, with the fixed production operator.
3. The smoke job; production held on docs and smoke, journeys reporting.
4. The 15-minute check, with its incident.io alert source.
5. The release lane.
6. Nuxt; React once the dev proxy reaches the cloud.

## Later: other dimensions

Each worth a lane of its own, roughly in this order:

1. **Schema changes.** The previous deployment's binary against the new
   schema. Expand/contract migrations are a rule today, not a test.
2. **Resilience.** A Go integration test with a tiny connection pool under
   concurrent requests: the cloud's one real incident so far.
3. **Self-hosted upgrades.** Data written by version N-1, migrated by N, then
   N's tests, nightly.
4. **Performance.** [`tools/bench`](../../../tools/bench/) on a schedule, with
   a threshold.
5. **An outdated CLI.** The server refuses a CLI older than a minimum version
   with a clear message, instead of failing somewhere in the middle.

## Open questions

- When does the cloud count as live, so journeys hold production and the
  published-CLI check becomes a rule?
- Is Angular a family of its own on the cloud? Its dev-server proxy has the
  same setting as Vite's.
