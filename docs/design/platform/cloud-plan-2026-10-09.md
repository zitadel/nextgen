# Cloud plan, 2026-10-09

Follow-up plan to the two-region spike (branch `claude/vercel-two-region-spike`;
what it established is the "Two regions and an identity home" section of
[preview-cloud-vercel-planetscale.md](preview-cloud-vercel-planetscale.md)).
Five items from the review of the spike plus one that came out of it, in the
order they were executed; the status note under each heading says what
landed on 2026-10-10. Revised once after Florian's reading (console mode,
the route table, headless regions) before the work started.

## 0. Where we stood (the morning of 2026-10-10)

One Vercel project (`nextgen-preview-cloud`, alias `nextgen-home.vercel.app`)
serves an identity home at the root, the EU region under `/eu` (fra1,
Frankfurt database) and the US region under `/us` (cle1, Ohio database), one
console at `/console`, and a landing page at `/`. One sign-in at the home is
accepted by both regions (`platform.home.url`: the region asks the home for
the session and provisions a shadow user). All of it deploys **prebuilt**
through `apps/cloud/regions/deploy.sh`, outside Git deployments, because the
Go preset drops per-function regions and the prefix-stripping route.

## 1. The create button fails: Vercel Authentication, not nextgen

> Done 2026-10-10: `same-origin`, verified with the cookie on every call.

`claim/init` is called with `credentials: "omit"` so that only the project
secret travels. On a protected preview that also drops the `_vercel_jwt`
cookie Vercel set after your dashboard sign-in, and Vercel's protection
layer answers 401 before the request reaches the region. The other calls
send `same-origin` and pass. `initClaim` is bearer-only in the OpenAPI
contract (`oauth2: project.write`), so the session cookie cannot interfere
with it: the `omit` was never needed.

Fix: `credentials: "same-origin"` on that one call, redeploy, verify in the
browser. Ten minutes.

## 2. The cloud console is the console in platform mode

> Done 2026-10-10 (first cut): the home's runtime document reports
> `mode: platform` with the regions; the console reads the person's
> projects from every region, follows the selected project's region for
> every call, shows the region beside each project and creates a project
> in a chosen region. The landing page is gone (2026-10-10): the console
> covers it.

Not a second app. Console ADR 0004 already decides this: "One Console
artifact and one authorization model serve cloud and self-host", and §6
lists platform mode as the same console with different defaults
(multi-project navigation, portal features configured by the platform). The
runtime document the server publishes carries `mode: "platform" |
"standalone"` for exactly this, and the console types it today without
using it. So the cloud console is `apps/console` booted from the home's
runtime document with `mode: "platform"`, and the portal screens are routes
in the same app, hidden in standalone by ADR 0004 §5's permission gating.

What platform mode needs, concretely:

- **Runtime document from the home** (`cmd/server/console_runtime.go`):
  `mode: "platform"` when the server is the home, plus the region directory
  as public metadata: `regions: [{id, name, api_base}]`. Ids and bases are
  public in the root ADR 005 sense; nothing secret.
- **Per-project API base in the console.** Today `apiBase` is one
  build-time constant (`api/zitadel.ts`). The project screens get their base
  from the selected project's region (`/eu`, `/us`), the account screens
  from the home (origin root). One client per base, created from the
  directory; the loaders take the base from route context instead of the
  module constant.
- **Portal routes**: regions and projects across regions (fan-out to each
  region's `/users/me/projects`, replaced by the directory in item 5),
  create a project in a region (today's create plus claim sequence, later
  the home's provisioning call), account (teams and memberships from the
  home), billing when item 5 delivers it. Gated by `permission` in
  `staticData` per ADR 0004 §5.
- **Sign-in** is unchanged: `/console/login`, the widget, the exchange at
  the home. The landing page `apps/cloud/regions/ui` was deleted on
  2026-10-10, the console covering it.

Trade-off accepted: the self-hosted console ships the portal routes as
code it never shows. The ADR takes that over a second artifact, and so do
we.

## 3. One deployment: regions, home, console, docs, website, storybook

> Done 2026-10-10: the root `vercel.json` carries the layout below, deployed
> non-prebuilt from the CLI; Git deployments as soon as the project is
> connected.

Merge the spike into the root `vercel.json` of PR #1518 so that one Git
deployment carries everything, previews included. The regions are
**headless** (item 6): APIs only, no console, no login UI. The console
serves the whole cloud from the home host. Route table, EU and US
identical:

| Path | Service | Region | Notes |
|---|---|---|---|
| `/`, `/_next/*` | website | static | marketing site, as in #1518 |
| `/docs*`, `/reference*`, `/llms*.txt`, `/mcp*` | docs | static | as in #1518 |
| `/storybook/*` | storybook | static | as in #1518 |
| `/console/runtime.json` | home | fra1 | the runtime document, `mode: platform` |
| `/console/*` | console | static | the console, platform mode |
| `/eu`, `/eu/*` | server_eu | fra1 | region API, prefix stripped |
| `/us`, `/us/*` | server_us | cle1 | region API, prefix stripped |
| everything else | home | fra1 | the home's API |

Dropped from the first version of this table: a hosted login at `/login/*`
(nobody signs into the home except through the console's `/login` route)
and the project console and login UI under the region prefix (`/eu/console`,
`/eu/login`): the console manages regional projects from `/console` with
the region as API base, so there is nothing to serve there. A hosted login
UI for *customers'* end-users of a regional project comes back under the
region prefix when a customer needs it (the same static artifact, with its
prefix taken from the URL at runtime instead of the Vite base); until then
customers embed the widget.

Changes this needs beyond routing:

- **Launcher**: already serves one database per region (`VERCEL_REGION` →
  `CLOUD_DATABASE_URL_<REGION>`, `CLOUD_DATABASE_KEY=HOME` for the home),
  already migrates every region in the `migrate` service's build step
  (`CLOUD_MIGRATOR_DATABASE_URL_*`), already renders the home URL. Nothing
  new except dropping the schema-in-URL workaround once deployments are Git
  deployments again (git metadata returns).
- **Per-function region and the prefix route** must come from the build,
  not from a patch script. That is item 4; item 3 cannot land as a Git
  deployment until 4 answers.
- **Environment**: today all three database URLs are project-wide, so each
  function holds the others' credentials. Acceptable for previews; the
  production answer depends on item 4's outcome (B below keeps them apart
  by construction).
- `deploy.sh`, `apps/cloud/regions/vercel.json` and the probe configs go
  away; the README's findings move into the design note.

## 4. Per-function regions: what is known, what to test

> Answered 2026-10-10, outcome A: T1 passed in a cloud build once the
> services were declared `framework: vite` (a service with no framework is
> refused). `apps/cloud/build-output.sh` is the build command.

Known today:

- The `vercel.json` schema allows `regions` per function pattern, also
  inside a service (`services.<name>.functions.<glob>.regions`), and the
  Go preset's build is registered with `src: "index.go"`, which is the key
  the spike used. It was ignored anyway: the `@vercel/go` builder (v20)
  does not contain the word `regions`, nor `maxDuration`; it
  passes none of the function config into the function it emits.
- The Build Output field `regions` in `.vc-config.json` is honoured (the
  spike runs on it), and the Build Output API documents it as a standard
  field. Next.js's `preferredRegion` per route is the same field.
- The top-level `regions` is deployment-wide. Multiple regions in one list
  is an Enterprise feature; distinct regions for distinct functions is not
  the same feature and is what the Build Output field gives on Pro.

So "Go functions close to their database" is a build-output question, not a
plan question. Two tests, one deployment each, non-prebuilt (`vercel deploy`
uploading sources, so Vercel's own build pipeline runs), then once more as
a Git deployment on the PR branch:

- **T1, emit the Build Output tree ourselves.** The `server_eu` service
  without `framework`, `buildCommand` = a script that compiles the launcher
  and writes `.vercel/output/config.json` (routes: the prefix-stripping
  route first, then the catch-all to the function) and
  `.vercel/output/functions/go.func/.vc-config.json` (`runtime: executable`,
  `handler: executable`, `architecture: x86_64`, `regions: ["fra1"]`,
  `environment`), i.e. exactly what the Go preset emits plus our two
  fields. Pass: `x-vercel-id` shows `fra1` for `/eu` and `cle1` for `/us`,
  and `/eu/readyz` returns 200 with the prefix stripped. This is the
  documented contract for any custom framework and it is what the prebuilt
  deployment already uploads, so it should work; the unknown is whether a
  service's build is allowed to produce its own output tree. The spike's
  `deploy.sh` patch script becomes that build script, which is less code,
  not more.
- **T2, container runtime.** `runtime: "container"` with a Dockerfile for
  the server, and the same `regions` question. Only if T1 fails; container
  functions have their own region setting to test.

Decision rule:

- **A. T1 passes** → one project, Git deployments, the table in item 3,
  done.
- **B. T1 and T2 fail** → one Vercel project per region plus one front
  project. Each regional project is Git-connected to the same repository
  with the same `vercel.json` (the launcher picks its database from
  `VERCEL_REGION` already) and gets its Function Region in project settings
  (fra1, cle1). The front project holds the home and every UI and rewrites
  `/eu/:path*` to the EU project's domain (external rewrites proxy the
  request, cookie included, and strip the prefix for free). Cost: three
  projects, UI services built three times unless `ignoreCommand` skips
  them in the regional projects, one extra edge hop for regional calls.
  Gain: each project holds only its own database credentials, which is the
  shape a dedicated customer needs anyway, and no Build Output tricks.

Either way the result is written into the design note as the per-region
placement rule.

## 5. The cloud console's server side

> First slice 2026-10-10: `apps/cloud/api`, the `cloud` service under
> `/cloud` with schema `cloud` in the home's database: `GET /cloud/regions`,
> `GET /cloud/me/projects` (placements), `POST /cloud/projects` (create and
> claim in a region, record the placement). The console still fans out and
> creates through the regions directly; switching it to these endpoints,
> teams as the owner instead of the person, billing, usage and
> provisioning jobs are next.

What the console in platform mode needs from a server that the product
does not offer: which region a project lives in, creating a project in a
region on behalf of a team, billing, usage across regions, support
lookups, later dedicated databases.

Where it lives: **a separate Go service, `cloud`, next to the home, not
inside the product server.** Reasons: Stripe, PlanetScale and region
directories are cloud concerns a self-hoster never runs; the home's nextgen
stays a plain nextgen in platform mode; the service is deployed like the
regional servers (Go, fra1, its own schema `cloud` on the Frankfurt
cluster) and reaches the home and the regions over HTTP with platform
credentials. It validates the browser's session the way regions do: ask the
home for `GET /sessions/me` with the cookie, cache a minute (the resolver
in `internal/api/homesession.go` is reusable as a client library).

Routes on the cloud host: `/cloud/*` → the `cloud` service. The region
directory in the runtime document (item 2) is the home reading the same
`regions` table, so the console has one boot document and one place to
ask for more.

Data it owns (schema `cloud`):

| Table | Holds |
|---|---|
| `regions` | id (`eu`, `us`), display name, Vercel region, database provider and region, API base, status, capacity flags |
| `placements` | project id → region, team id (home), database kind (`shared`, `dedicated`, `byo`), database ref, created at |
| `subscriptions` | team id (home) → plan, Stripe customer and subscription ids, status, current period |
| `usage` | project id, period, counters reported by the region (users, auth attempts, API calls) |
| `provisioning_jobs` | create or move a project, create a dedicated database; state machine with retries |

What stays in the home's nextgen: accounts (users of the platform
project), teams and memberships (the paying account is a team in the
platform project, as the resource map says), invitations, team API keys.
`/teams/{id}/billing` in the resource map is the product's hook; the
`cloud` service is what answers behind it.

API for the first cut:

- `GET /cloud/regions` — the directory, public.
- `GET /cloud/me/projects` — placements of the caller's teams, with each
  project's region and API base. Replaces the console's fan-out.
- `POST /cloud/projects {name, region, team_id}` — the home-side create:
  creates the project in the region with a platform credential, claims it
  for the caller's shadow team in that region, records the placement.
  Idempotent through `provisioning_jobs`.
- `GET /cloud/teams/{id}/billing`, `POST …/billing/checkout` (Stripe
  Checkout session), `POST /cloud/billing/webhook` (Stripe events →
  subscription state).
- `GET /cloud/teams/{id}/usage` — aggregated from the regions.
- Support: read-only lookups across the above with an operator role on the
  home's platform project; impersonation is not in the first cut.

The directory also feeds the routing layer: `placements` → Global Config
(`project_id → region`) for the Routing Middleware that sends an untagged
request to its region, and a region tag in new ids and keys so most
requests never need the lookup.

## 6. Headless regions, and what the platform flag implies

> Done 2026-10-10: `server.ui` (embedded, external, headless), the `noui`
> build tag, the launcher defaults by role.

The server already has the switches: `server.console_enabled` and
`server.login_enabled` (both default true) skip the UI mounts, and
`/console/runtime.json` is mounted only while one of them is on. What is
missing is the third shape, and the build:

- **Headless** (a region): both off. Config only, works today. A region
  then answers APIs and nothing else, which is what "disable the consoles
  from the regions" asked for.
- **External UI** (the home): no embedded UIs, but the runtime document
  must be served because the console is a static service next to it.
  Today that needs one of the flags on, which mounts a stub UI. Add
  `server.ui: embedded | external | headless` (or a `runtime_document`
  switch) so the home serves the document without the stub.
- **Build**: the cloud build stubs `internal/staticui/*/dist/index.html`
  only because `//go:embed all:dist` needs the directory at compile time.
  A build tag (`-tags noui`) with an empty embed behind it removes the
  stubbing from `build.sh`.
- **Defaults from the platform role**: `platform.home.url` set means "I
  am a region" and defaults to headless; the home (a new
  `platform.mode: home`, which also flips the runtime document to
  `mode: platform` and adds the region directory) defaults to external.
  Self-hosters keep embedded. One flag per role, no new concept.

## Order and effort

| Step | Depends on | Size |
|---|---|---|
| 1. `same-origin` fix | – | minutes |
| 4. T1 (and T2 if needed), decision A or B | – | half a day |
| 6. UI modes and the build tag | – | half a day |
| 3. merge into the root deployment | 4, 6 | 1–2 days |
| 2. console platform mode: runtime document, per-project base, portal routes | 6 for the document; can start on the spike host | 2–3 days for the first cut |
| 5. `cloud` service: regions, placements, create; billing after | 2 and 3 | 3–5 days for regions, placements and create; billing is its own chunk |

Steps 1, 4 and 6 can run today. Step 2 can start in parallel with 3
against the spike host.

## Browser testing

Resolved: the built-in browser is signed into Vercel and into the home, so
protected previews open there and the console can be clicked through as
you. Sign-in itself stays on your side (no credentials typed by me on a
deployed host).
