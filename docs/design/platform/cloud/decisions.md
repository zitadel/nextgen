# Cloud decisions

The decisions behind the cloud, oldest first, each with the reason it was
taken and where the evidence is. Some reverse earlier ones; both stay, marked,
because a reversal is part of the reason for what runs today. The dated notes
under [history/](history/) hold the full measurements; the cloud as it stands
is the [README](README.md).

> **Status:** the decisions of the proof as they were taken; "today" below
> is 2026-10-11, the proof's last day. On 2026-10-12 [#1655](https://github.com/zitadel/nextgen/pull/1655) deployed
> `main` to the Vercel project `cloud` and carried these over: Vercel (C2,
> C30), PlanetScale Postgres (C1) with the server next to it (C3), the cloud
> from this repository (C4), one project with every app a service (C5),
> main as production (C7), migrations in a build step (C9), PgBouncer for
> serving and the direct port for migrating (C10). It reversed C8 and C46
> for previews: a database per preview branch, not a schema. What it did not
> carry, the identity home, the regions, the control plane and the container
> functions with their bindings (C17 to C24, C31 to C33), stays on the proof's branch,
> [`claude/nextgen-deployment-research-3b5ebe-code`](https://github.com/zitadel/nextgen/tree/claude/nextgen-deployment-research-3b5ebe-code).

## Holds today

- **Where it runs:** Vercel ([C2](#c2), [C30](#c30)), one project with every
  app a service ([C5](#c5)), the servers as container images, one image per
  deployment ([C31](#c31), [C32](#c32)).
- **Data:** PlanetScale Postgres ([C1](#c1)), a database per region with its
  server pinned next to it ([C3](#c3), [C17](#c17)), served through PgBouncer
  with four connections per pool, migrated on the direct port ([C10](#c10),
  [C29](#c29)).
- **Routing:** regions under path prefixes of one host ([C18](#c18)), the
  docs under `/docs` alone ([C48](#c48)); internal calls over service
  bindings ([C33](#c33)).
- **Accounts:** an identity home the regions ask about its sessions, for now
  ([C19](#c19)); the console in platform mode ([C21](#c21)); a control plane
  of its own that creates projects in the regions ([C23](#c23),
  [C39](#c39)).
- **Releases:** migrations in a build step, never at startup ([C9](#c9),
  [C38](#c38)); every deployment in schemas of its own, for each region, the
  home and the control plane ([C8](#c8), [C46](#c46)).
- **Deploys:** from Git, team only. Until the merge every push to PR #1518's
  branch deploys production and previews are off; production runs on the
  preview databases until it gets its own ([C47](#c47)). After the merge,
  `main` is production ([C7](#c7)). Every deployment gets its smoke test and
  journeys; holding the production domain until they pass waits for the
  merge ([C50](#c50)). A server refuses a schema behind it ([C51](#c51)).
- **Observability:** logs fitted to Vercel ([C44](#c44)); the frontends'
  page views and speed in Vercel ([C49](#c49)); where telemetry goes is
  open ([C40](#c40)).
- **Systems**, a customer's own database, are out of the code until the
  product needs them ([C43](#c43)).

## How to read this

**Status words**

| Status | Means |
|---|---|
| **holds** | Decided and in force. A qualifier narrows it: *for previews* (production decides again), *interim* (until a replacement the entry names), *until the merge* (of PR #1518; the entry says what changes), *for the POC branch* (PR #1518's branch stands in for `main`, [C47](#c47)) |
| **accepted for previews** | A known cost the previews live with; production may not |
| **proposed** | Written down, not decided |
| **open** | Still to be decided |
| **concept** | Designed, not in the code; *concept (C43)* was built, proven and taken out again |
| **superseded by** Cn | Reversed; the newer decision says why |
| **rejected** | Tried or weighed, and not taken |

<a id="ids"></a>

**Ids** across the cloud's notes

| Id | Stands for | Where |
|---|---|---|
| C | a decision | this file |
| S | a security finding | [security](security.md) |
| P1 to P5 | a proof of the MVP; in systems §11 and §12, P1 is also the routing POC's pool-size run | [MVP plan](history/2026-10-10-mvp-plan.md), [systems](systems.md) |
| D1 to D6 | a decision settled with Florian for the MVP | [MVP plan](history/2026-10-10-mvp-plan.md) §6 |
| T1 to T6 | a test on Vercel: T1 and T2 of the cloud plan (§4), T2 to T6 of the containers plan | [cloud plan](history/2026-10-09-cloud-plan.md), [containers plan](history/2026-10-10-containers-plan.md) |
| R1 to R6 | a run of the routing POC | [systems](systems.md) §11 and §12 |

Evidence links point at these notes:
[journal](history/2026-10-07-preview-cloud-journal.md) (2026-10-07 to 10),
[cloud plan](history/2026-10-09-cloud-plan.md) (2026-10-09),
[containers plan](history/2026-10-10-containers-plan.md) and
[MVP plan](history/2026-10-10-mvp-plan.md) (2026-10-10),
[systems](systems.md), [auth plan](auth-plan.md),
[provider fit](provider-fit.md), [security](security.md). The
[experiments](experiments.md) page indexes them: one row per concept, with
its test and its result.

## Index

| # | Decision | Date | Status |
|---|---|---|---|
| [C1](#c1) | PlanetScale Postgres, not Neki | 10-07 | holds |
| [C2](#c2) | Vercel, not Cloudflare Containers | 10-07 | holds |
| [C3](#c3) | The server sits next to its database | 10-07 | holds |
| [C4](#c4) | The cloud ships from this repository | 10-07 | holds |
| [C5](#c5) | One Vercel project, every app a service | 10-08 | holds |
| [C6](#c6) | The docs build unchanged; the cloud lists their paths | 10-08 | superseded by C48 |
| [C7](#c7) | Main is production; Vercel builds the current commit | 10-08 | holds, for the POC branch until the merge (C47) |
| [C8](#c8) | A schema per preview, not a database per preview | 10-08 | holds |
| [C9](#c9) | Migrations run in a build step, never at startup | 10-08 | holds |
| [C10](#c10) | Serve through PgBouncer, migrate on the direct port | 10-08 | holds |
| [C11](#c11) | The server on Vercel's Go preset | 10-08 | superseded by C12 |
| [C12](#c12) | The server as a container image again | 10-08 | superseded by C14 |
| [C13](#c13) | Cloudflare Containers, re-tested | 10-08 | rejected |
| [C14](#c14) | The Go preset after all | 10-09 | superseded by C31 |
| [C15](#c15) | No keep-warm cron | 10-09 | holds for previews |
| [C16](#c16) | CockroachDB across regions | 10-09 | rejected |
| [C17](#c17) | One project serves every region, each function pinned to its database | 10-09 | holds |
| [C18](#c18) | Regions under path prefixes of one host | 10-09 | holds |
| [C19](#c19) | An identity home; regions ask it about its sessions | 10-09 | holds, interim |
| [C20](#c20) | Environment variables are per project | 10-09 | accepted for previews |
| [C21](#c21) | The cloud console is the console in platform mode | 10-10 | holds |
| [C22](#c22) | Regions are headless; the home serves the runtime document only | 10-10 | holds |
| [C23](#c23) | The control plane is a service of its own | 10-10 | holds |
| [C24](#c24) | Home tokens instead of the cookie across deployments | 10-10 | proposed |
| [C25](#c25) | A dedicated customer is a region with one customer | 10-10 | concept (C43) |
| [C26](#c26) | Project routing rules carry systems, no middleware | 10-10 | concept (C43) |
| [C27](#c27) | A system's database address travels sealed with the request | 10-10 | concept (C43) |
| [C28](#c28) | Versions are slots, not routes to older deployments | 10-10 | concept |
| [C29](#c29) | Four connections per pool, two to four per system | 10-10 | holds per pool, concept (C43) per system |
| [C30](#c30) | Stay on Vercel | 10-10 | holds |
| [C31](#c31) | Containers after all | 10-10 | holds |
| [C32](#c32) | One image per deployment, referenced by Build Output functions | 10-10 | holds |
| [C33](#c33) | Service bindings for internal calls | 10-10 | holds |
| [C34](#c34) | Flags decide behaviour, routing carries placement | 10-10 | holds |
| [C35](#c35) | The MVP is a proof on the feature branch | 10-10 | holds until the merge |
| [C36](#c36) | An app per system inside a region's process | 10-10 | concept (C43) |
| [C37](#c37) | The static system stays beside the dynamic ones | 10-10 | superseded by C43 |
| [C38](#c38) | The control plane migrates in the build too | 10-10 | holds |
| [C39](#c39) | The console creates through the control plane, lists through the regions | 10-10 | holds |
| [C40](#c40) | Observability: ids and attributes now, the backend later | 10-10 | open |
| [C41](#c41) | The routing POC is removed | 10-10 | holds |
| [C42](#c42) | The control plane keeps the regions' CSRF rule; no bypass secret on internal calls | 10-10 | holds |
| [C43](#c43) | Systems leave the code until the product needs them | 10-10 | holds |
| [C44](#c44) | Our logs fitted to Vercel, our traces to a backend of our own | 10-10 | holds for logs, proposed for traces |
| [C45](#c45) | Previews share the home and the control plane | 10-10 | superseded by C46 |
| [C46](#c46) | Every deployment has schemas of its own | 10-11 | holds |
| [C47](#c47) | Until the merge, production deploys from the pull request's branch | 10-11 | holds until the merge |
| [C48](#c48) | The docs are a Next.js app, and everything they serve is under /docs | 10-11 | holds |
| [C49](#c49) | The frontends report page views and speed to Vercel | 10-11 | holds |
| [C50](#c50) | Production moves only after the deployment's checks pass | 10-11 | proposed, blocking after the merge |
| [C51](#c51) | A server refuses a database that lacks its migrations | 10-11 | holds |

## The foundation (2026-10-07 and 08)

<a id="c1"></a>

### C1 · PlanetScale Postgres, not Neki · holds

Neki failed nextgen on three core shapes, on an unsharded database: DDL inside
a transaction is accepted and silently gone after the commit (goose runs 25
of 26 migrations in one), correlated subqueries (every authorization check)
and data-modifying CTEs (user create). Plain PlanetScale Postgres ran every
migration and probe unchanged. Re-test Neki when its router supports those
shapes. Evidence: journal, "Neki findings" and "PlanetScale Postgres
findings".

<a id="c2"></a>

### C2 · Vercel, not Cloudflare Containers · holds

Vercel had routing built in (one rewrite), autoscaling with scale to zero, and
`fra1` in the same metro as the database; Cloudflare needed a Worker and a
Durable Object per replica, a manual replica count, a region-level placement
and showed a cold-start p95 around 24 s. Evidence: journal, "Decision". C13
re-tested it.

<a id="c3"></a>

### C3 · The server sits next to its database · holds

A write is 20 to 60 database round trips, so latency is round-trip time times
round trips: a user create took 3.7 s from a laptop on the US west coast and
0.23 s from `fra1`. Placement is therefore a property of each database, which
is what makes regions a routing question (C17). Evidence: journal, "First
Vercel deploy".

<a id="c4"></a>

### C4 · The cloud ships from this repository · holds

The launcher mirrors the server's configuration and the deployment is a
function of the server's code, so `apps/cloud` changes in the same pull
requests as the server. The docs and the website join as siblings. Evidence:
journal, "Repo shape".

<a id="c5"></a>

### C5 · One Vercel project, every app a service · holds

Services give one route table, one protection setting and one firewall for
the server, docs, website, storybook and console, with separate builds;
Microfrontends or a wrapper project would add per-app lifecycles nobody
needed yet. The path map moves there unchanged if that need comes. Bare UI
prefixes redirect to their slash form, since a relocated static app resolves
relative assets against `/`. Evidence: journal, "Docs as a second service",
"Main is production".

<a id="c6"></a>

### C6 · The docs build unchanged; the cloud lists their paths · superseded by C48

A Waku `basePath` needed a post-build relocation of Waku's Vercel output and
moving 40 pages to avoid a `/docs/docs` segment; it was reverted for a list
of rewrites (`/docs`, `/reference`, `/assets`, `/RSC`, `/api/search`,
`/llms*.txt`, `/mcp`). Evidence: journal, "Main is production". The docs
left Waku in [C48](#c48), and the list with it.

<a id="c7"></a>

### C7 · Main is production; Vercel builds the current commit · holds, for the POC branch until the merge (C47)

The preview cloud exists to show the latest state; a pinned release tag goes
stale by construction, and an image per commit in GitHub only existed to run
the migrations from the same bits, which a build of the same commit does.
What makes it safe: migrations only in the build of the commit deployed
(C9), production values only in the Production target, rollback by promoting
an older deployment over expand-and-contract migrations. Version tags stay
the self-hosters' artifact. Evidence: journal, "Main is production".

**Today** (since 2026-10-11): in effect, with PR #1518's branch in place of
`main` ([C47](#c47)). Every push to that branch deploys production. Of what
makes it safe, "production values only in the Production target" holds for
the master key and the admin document only: production runs on the preview
databases, in schemas of its own ([C46](#c46)). At the merge `main` takes
over ([undo at the merge](https://github.com/zitadel/nextgen/blob/claude/nextgen-deployment-research-3b5ebe-code/docs/runbooks/preview-cloud.md#undo-at-the-merge)).

**Before** (past): configured in `vercel.json` but not in effect. Every
deployment was a CLI upload, and production did not boot.

<a id="c8"></a>

### C8 · A schema per preview, not a database per preview · holds

The server runs in any Postgres schema, named by a `schema` parameter of the
connection string that the server consumes itself, because PgBouncer refuses
`search_path` as a startup parameter. A pull request's preview migrates and
serves `pr_<n>` (a branch without one `br_<name>`) in each region's preview
database, which all previews share; extensions are pinned to `public`. A deployment uploaded by the CLI
carries no git metadata, so it names its schema outright (`CLOUD_SCHEMA`).
Evidence: journal, "One schema per PR preview"; containers plan, phase A.

Since [C46](#c46) (2026-10-11) the name is a schema base, and it covers
every role: a region serves `<base>`, the home `<base>_home`, the control
plane `<base>_cloud`. From the regional layout until then it covered the
regions only, and every preview shared the home and the control plane
([C45](#c45), superseded). Only the `schema` parameter names a schema; a
`search_path` does not, and the server refuses `public` and Postgres's own
system schemas.

<a id="c9"></a>

### C9 · Migrations run in a build step, never at startup · holds

A binary ahead of its schema boots green and fails per request, and a
rollout runs old and new side by side, so migrations are expand-and-contract
and applied before a deployment takes traffic. They run in the build step of
an internal service (`migrate`) whose failure fails the deployment, never a
serving function; the serving launcher refuses `--migrate`; production
migrates only from its production branch, `main` (PR #1518's branch until
the merge, [C47](#c47)). The GitHub runner left the deploy path for this.
Extended to every regional database (C17) and the control plane (C38).
Vercel's own guidance for containers says the same. Evidence: journal,
"Migrations in the build"; containers plan §1.

<a id="c10"></a>

### C10 · Serve through PgBouncer, migrate on the direct port · holds

Vercel starts an instance per concurrent request when none is warm, each a
full server with its own pool; 24 concurrent creates exhausted the 25 slots
of the preview cluster, and the instances that could not connect died at
boot. Through PgBouncer (port 6432, transaction pooling) 72 of 72 passed.
Serving URLs carry `pool_max_conns=4` and
`default_query_exec_mode=cache_describe` (no named prepared statements);
migrations use port 5432, because goose holds a session advisory lock;
a small cluster needs `max_connections` raised (50 on the PS-5 preview
cluster). Evidence: journal, "Back to the
container, through PgBouncer".

## The runtime, back and forth (2026-10-08 to 10)

<a id="c11"></a>

### C11 · The server on Vercel's Go preset · superseded by C12

The server moved from the container image to Vercel's Go preset, because it
built and started much faster: the whole deployment built in 156 s against
370 to 403 s for the image, and a cold start took 0.3 to 0.45 s against
2.3 s. Evidence: journal, "Go runtime instead of the container".

<a id="c12"></a>

### C12 · The server as a container image again · superseded by C14

Under 24 concurrent requests the Go runtime failed, which read as one request
per instance. It was the database refusing connections (C10), so the reason
did not hold. Evidence: journal, "Back to the container", with the
correction in "The Go runtime after all".

<a id="c13"></a>

### C13 · Cloudflare Containers, re-tested · rejected

Worker Previews removed the objection that previews had no server. The spike
worked (72 of 72 creates) but writes were several times slower (a seeded
create 1.8 to 2.2 s against 0.35 s): the containers started near the first
request, in Madrid, and a seeded create makes about sixty round trips to
Frankfurt. Reopen with city-level placement.
The spike was deleted on 2026-10-09. Evidence: journal, "Cloudflare
Containers spike".

<a id="c14"></a>

### C14 · The Go preset after all · superseded by C31

Measured again: the Go runtime serves concurrent requests, builds in a quarter
of the CPU minutes and boots in a fraction of a second. Right on the facts it
had; C31 reversed it on facts it did not have. Evidence: journal, "The Go
runtime after all".

<a id="c15"></a>

### C15 · No keep-warm cron · holds for previews

94 of 120 five-minute pings landed on a cold instance anyway, and an instance
kept warm around the clock bills its memory the whole time (about $22 a
month). Production revisits it together with background work on a tick.
Evidence: journal, "Ready for production".

## Regions and the home (2026-10-09 and 10)

<a id="c16"></a>

### C16 · CockroachDB across regions · rejected

A three-region CockroachDB cluster (Frankfurt primary) was tried as the
database of a preview: about a hundred lines of textual migration rewrite made
it connect (no advisory locks, no `COLLATE "C"`, no hash partitions, no
`btree_gin`, different trigger syntax), but DDL took up to 48 s per migration
file, which rules out migrating in the build and any development loop. Nothing
of the spike is in the repository; a single-region cluster is the only fair
re-test of the DDL latency.

<a id="c17"></a>

### C17 · One project serves every region, each function pinned to its database · holds

A function deployed to several regions answers from the region closest to
the request; nothing steers it per request, so routing to a region means
routing to a function pinned there. The pin is `regions` in the function's
Build Output `.vc-config.json`, which a service's own build command writes
(`apps/cloud/build-output.sh`; a service declared `framework: vite` runs the
command and deploys the emitted tree); the Go preset ignored per-function
regions. Each database bootstraps its own platform project; a project's
secret is a 401 in any other region. The fallback, a Vercel project per
region behind a front project, was not needed. Evidence: cloud plan §4;
journal, "Two regions and an identity home".

<a id="c18"></a>

### C18 · Regions under path prefixes of one host · holds

Host routing works (a `has: host` rewrite was the first shape). Paths won
for four reasons: the home's session cookie is host-only, so on one host it
reaches `/eu` and `/us` and one sign-in covers every region without tokens;
`vercel.app` is a public suffix, so no cookie spans two `vercel.app` hosts;
one origin needs no CORS; and a path rule needs no DNS or certificate, which
is how a system lived at `/sys/<name>` until systems left the code
([C43](#c43)). The cost: the region is part of the
API base. Hosts per region come back with a custom domain and home tokens
(C24). Evidence: MVP plan §2.

<a id="c19"></a>

### C19 · An identity home; regions ask it about its sessions · holds, interim

The home holds the cloud's accounts and nothing of any project. A region
cannot read the home's cookie (a token the home encrypted), so it asks the
home (`GET /sessions/me` with the cookie, over a service binding, cached a
minute) and provisions a shadow of the person into its own platform project.
It was the smallest shape that works; a signed token replaces the lookup
without changing what follows (C24). Known gaps: a revocation at the home
reaches a region only within its cache's minute, the home's outage stops
uncached regional requests, the shadow's attributes are never refreshed.
Evidence: journal, "Two regions and an identity home"; security.

Since the review of PR #1518: a region accepts only sessions of the home's
platform project (security S14); signing out at a region signs out at the
home (`DELETE /sessions/me` forwarded with the cookie and the CSRF header,
the region's cached answer dropped); a personal team that cannot be ensured
is logged instead of refusing the request; and two first requests at once
no longer fail.

<a id="c20"></a>

### C20 · Environment variables are per project · accepted for previews

Vercel gives every function of a project every variable of its target, so
every function holds every database's credentials; the launcher keeps the
one of its region and drops the rest before the server starts. A deployment
that must never hold another region's credentials is a project of its own.
Evidence: journal, "Two regions and an identity home"; security.

<a id="c21"></a>

### C21 · The cloud console is the console in platform mode · holds

Console ADR 0004 already decided one console artifact and one authorization
model for cloud and self-host, and the runtime document carries `mode`. The
home's runtime document reports `mode: platform` and the regions; the console
follows the selected project's region for every call. Evidence: cloud plan
§2.

<a id="c22"></a>

### C22 · Regions are headless; the home serves the runtime document only · holds

The console manages regional projects from `/console` with the region as API
base, so a region serves no UI. `server.ui` (embedded, external, headless) and
the `noui` build tag replaced stub UIs in the build. No hosted login at the
home: the console's own sign-in route is the cloud's. Evidence: cloud plan
§3, §6.

<a id="c23"></a>

### C23 · The control plane is a service of its own · holds

The list of regions, the record of which region each project lives in,
billing and database provisioning are cloud concerns a self-hoster never
runs, so they live in `apps/cloud/api` under `/cloud`, with a schema of its
own in the home's database (`cloud`; `<base>_cloud` since [C46](#c46)), and
the home stays a plain nextgen. Evidence: cloud plan §5.

<a id="c24"></a>

### C24 · Home tokens instead of the cookie across deployments · proposed

The cookie is a bearer with no audience and the session's lifetime; every
deployment on the host receives it. The plan: the cookie stays at the home,
which mints five-minute tokens per audience (a region, the control plane)
asserting the person's teams; a region decides with its own grants; the
control plane exchanges tokens instead of borrowing the cookie. The product
team's work (C35). Evidence: auth plan.

Since the research of 2026-10-11 ([auth-research.md](auth-research.md)): the
shape holds against other products and the standards. RFC 10017 names it a
token-mediating backend; Clerk, WorkOS, Entra and Auth0 work this way, and AWS
Verified Permissions and OpenFGA expand groups from a token the same way.
Changed in the plan: the request, the token and discovery follow RFC 8707,
9068 and 8414; at most 50 teams in a token, an explicit overage above;
removals pushed to the regions, so they take effect within seconds; step-up
per RFC 9470; the `__Host-Http-` cookie; the control plane's actor credential
is its Vercel OIDC token once it is a project of its own; only ids in the
regions. The separation is only as real as the Vercel projects (S1), and
the tokens make that split cheap.

## Systems and routing (2026-10-10)

<a id="c25"></a>

### C25 · A dedicated customer is a region with one customer · concept (C43)

A region is a key with a placement and a database. Compute is per placement
and is code; customers are rows and routing rules. A Vercel project per
customer was rejected: two operating models, and Vercel scales one project;
full isolation is self-hosting. Evidence: systems §1, §9.

<a id="c26"></a>

### C26 · Project routing rules carry systems, no middleware · concept (C43)

A rule per system matches a host and/or a path, rewrites to the regional
server and sets the system header; it is staged, published and rolled back
by API, takes effect without a deployment, survives redeploys and costs no
latency (POC R1 to R5). Published rules also reach preview deployments.
Routing Middleware stays the upgrade if a decision ever needs code. The
destination is written `/eu/:path`; `:path*` appends a literal `*`.
Evidence: systems §2, §12; MVP plan P1.

<a id="c27"></a>

### C27 · A system's database address travels sealed with the request · concept (C43)

A server built last month must serve a customer onboarded today, so no
deployment may need to know the customers: the rule carries the address.
Sealed, because an address in clear would sit in logs, and a header the
server trusted would let anyone point it at a database of their choosing.
The server opens it, checks that the system is placed in its own region and
refuses anything else with a 400, never falling back to the shared database.
How far the seal also authenticates is a finding of the security review.
Evidence: systems §3; MVP plan P1.

<a id="c28"></a>

### C28 · Versions are slots, not routes to older deployments · concept

A pinned version would be a service built from a release binary next to the
latest: one route table in one deployment, reproducible locally, no
protection bypass, no dependency on deployment retention. Pinning needs a
database of the customer's own, since a shared region runs one schema.
Evidence: systems §4.

<a id="c29"></a>

### C29 · Four connections per pool, two to four per system · holds per pool, concept (C43) per system

With one connection per instance, requests stalled past 60 s at 150 and 200
concurrent; four was clean to 200. Evidence: systems §12, P1. The pools
per system left the code with systems ([C43](#c43)); four per pool holds.

<a id="c30"></a>

### C30 · Stay on Vercel · holds

Fly, Render, Railway and the GCP in use were weighed against the systems
model and their 2026 record. Vercel stays: Services, Dockerfile functions,
bindings and queues are where it is heading, and since always-on instances
are not coming, the server gets a triggered mode for background work
instead. Evidence: provider fit.

<a id="c31"></a>

### C31 · Containers after all · holds

A container image gets `SIGTERM` and 30 seconds at scale-in, the Go preset
gets no signal, so only a container drains the audit buffer and the event
shipper (verified: T4). The image CI releases can become the one artifact,
and container services can declare service bindings. Costs accepted: an image
build per deployment (74 to 90 s) and a cold start of about 2.2 s in `fra1`;
warm, 200 concurrent requests ran faster than on the preset. Evidence:
containers plan.

<a id="c32"></a>

### C32 · One image per deployment, referenced by Build Output functions · holds

Vercel's container builder takes the Dockerfile's own directory as the build
context and only a Dockerfile basename as `entrypoint`, so one
`Dockerfile.vercel` at the repository root builds one image in an `image`
service. A service's `command` is refused by the CLI and a function's
`command` is not honoured, and nothing in a container names its service, so
the server services stay Build Output functions that reference the image and
carry their role; the image's entrypoint picks the binary from the role.
Built by Vercel for now, by CI later (MVP decision D6). Evidence: containers
plan, phase A.

The functions name the image by the tag Vercel gives it: the commit's first
12 characters in a deployment from Git (`image:19115045608d`), the
deployment's id in a CLI upload. `build-output.sh` named the deployment's id
either way, so the first production deployment from Git failed with
`invalid_output VCR image not found` ([C47](#c47)). Since 2026-10-11 it names
the commit's 12 characters when `VERCEL_GIT_COMMIT_SHA` is set and the
deployment's id otherwise, and `vercel_config_test.go` checks both tags.
Evidence: commit `e618781f`.

<a id="c33"></a>

### C33 · Service bindings for internal calls · holds

The control plane reaches the home and the regions, and the regions the
home, over bindings: they reach the caller's own deployment past deployment
protection, enter the target's route table, and cannot be reached from the
internet. They replaced the protection-bypass secret on internal calls. A
binding grants reachability, not identity. Evidence: containers plan T6;
security.

<a id="c34"></a>

### C34 · Flags decide behaviour, routing carries placement · holds

Who gets which version or feature is a flag's decision; carrying it out is a
routing rule. Reading a flag on every API request is billed (Vercel Flags,
$0.03 per 1,000 on Pro) and needs a JavaScript middleware in front of a Go
server; a share of traffic on a new version is Rolling Releases, for the
whole deployment. Evidence: MVP plan §7; systems §7.

## The MVP (2026-10-10)

<a id="c35"></a>

### C35 · The MVP is a proof on the feature branch · holds until the merge

The proof that nextgen's backend runs the Vercel way: routing to regions, a
database per routed system (proven, then taken out by [C43](#c43)),
migrations as a release step, observability, a well-built `vercel.json`, one
console. Settled with Florian: D1 the feature branch, a `vercel.app` domain
and path prefixes; D2 teams across regions, billing and onboarding are the
product team's; D3 billing later; D4 accounts in the Frankfurt home; D5
Vercel Pro; D6 the image built by Vercel as a start. Evidence: MVP plan.

**At the merge.** "On the feature branch" ends when PR #1518 merges (branch
`claude/nextgen-deployment-research-3b5ebe`): the repository squash-merges
and deletes the branch, and the code is on `main`. Until then the MVP runs
as production from that branch, team only ([C47](#c47)); at the merge, the
runbook's
[undo at the merge](https://github.com/zitadel/nextgen/blob/claude/nextgen-deployment-research-3b5ebe-code/docs/runbooks/preview-cloud.md#undo-at-the-merge)
moves production to `main`. (Until 2026-10-11 it ran as the CLI-uploaded
preview at `nextgen-home.vercel.app`.) The rest holds: a proof, not a
launch; a `vercel.app` domain and path prefixes; D2 to D6.

<a id="c36"></a>

### C36 · An app per system inside a region's process · concept (C43)

A pool per system inside one app would share in-memory caches across
databases: the signing-key cache is keyed by project id, and the platform
project's id repeats in every database. So a system gets the same services,
caches, pool and jobs the server builds for its own database, built on its
first request (35 to 190 ms), at most 16 per instance, closed after ten idle
minutes. Evidence: MVP plan P1.

<a id="c37"></a>

### C37 · The static system stays beside the dynamic ones · superseded by C43

`system_acme`, a service with a database of its own, is what the console and
the control plane list as a region today. Systems added by routing rules
are the path that scales, since a service per system means a deployment per
customer, every function holding every system's address, and at most 100
services. The static one goes once the control plane manages dynamic systems.
Evidence: MVP plan P1.

<a id="c38"></a>

### C38 · The control plane migrates in the build too · holds

`api migrate` runs in the `migrate` service's build after the launcher's;
a serving instance only checks that its schema is at least as new as its
migrations, so an older deployment rolled back to keeps serving. A failing
migration stopped a deployment, and a rollback across a migration held in a
drill. goose skips database versions it does not know but refuses an
unapplied file older than the database's latest, so migration numbers must
stay in order across merges. Evidence: MVP plan P3.

<a id="c39"></a>

### C39 · The console creates through the control plane, lists through the regions · holds

The control plane makes the region's calls over its binding and records which
region the project lives in. Listing stays with the regions, which know
access through teams until the control plane's records do. So if the record
fails after the region created the project, the create still answers 201 and
logs `control plane: record placement`; the region's calls and the record run
to the end even if the browser leaves. Evidence: MVP plan P5.

Until the review of PR #1518 (2026-10-10), a home without a control plane
answered 404 and the console created the project in the region itself. That fallback is gone: a
create made in the region directly leaves no record of where the project
lives, so a 404 from `/cloud` now fails the create.

<a id="c40"></a>

### C40 · Observability: ids and attributes now, the backend later · open

Every request has an id (`X-Request-Id`), the launcher stamps where telemetry
comes from (`OTEL_RESOURCE_ATTRIBUTES`), and the control plane logs the
regions' request ids. (A system's log lines also named the system, until
systems left the code, [C43](#c43).) Where it all goes is the team's choice:
a Vercel drain is standing
configuration that sends data to a third party ($0.50 per GB on Pro).
Evidence: MVP plan P2.

<a id="c41"></a>

### C41 · The routing POC is removed · holds

`apps/cloud/routing-poc` was a throwaway from the start; its results are in
systems §12 and the containers plan (T2, T6). The Vercel project
`nextgen-routing-poc` still exists until someone deletes it.

## Security (2026-10-10)

<a id="c42"></a>

### C42 · The control plane keeps the regions' CSRF rule; no bypass secret on internal calls · holds

The control plane accepted the cookie on its one write with no origin check
and no token, and then derived the region's token from the cookie, which
emptied the regions' check on that path; it now applies the same rule. The
protection-bypass header left the launcher and the control plane, since
bindings carry every internal call. Both from the home-to-region review,
which orders what else to fix. Evidence: security S6, S13.

The project's automation bypass secret still exists for one outside use:
the smoke test of a protected deployment, by hand or by the `cloud-smoke`
workflow, which reads it from a repository secret
([runbook](https://github.com/zitadel/nextgen/blob/claude/nextgen-deployment-research-3b5ebe-code/docs/runbooks/preview-cloud.md#operating)).

## After the proofs (2026-10-10, night)

<a id="c43"></a>

### C43 · Systems leave the code until the product needs them · holds

The MVP proved that a region can serve a customer's own database, routed by
a rule without a deployment (C25 to C27, C36). Nothing needs that yet: the
product's first step is the shared regions, and the feature brought work
of its own, an envelope that still had to be authenticated and given an
expiry (security S3, S4), and a trap, since a rule pointing at a server
without the feature lands in the shared database. So the code left on
2026-10-10, the night it was proven: the server's system router and its
`platform.systems` settings, the launcher's `seal` command and the systems it
turned on in every region, and the static system `acme` with its service.
The concept stays in [systems.md](systems.md), and the code is to come back
with S3 and S4 fixed. It lives only in PR #1518's history, since the
repository squash-merges and deletes merged branches:
`git fetch origin pull/1518/head`, then `git show 602d0ae0` lists what left.
It came in with `8b6d0adf` (the static system), `1ae4e897` (the sealed
envelopes) and `b04537ed` (the system on log lines).

<a id="c44"></a>

### C44 · Our logs fitted to Vercel, our traces to a backend of our own · holds for logs, proposed for traces

Florian asked whether the server should be instrumented for Vercel's logs
and traces. Vercel shows a container's output but cannot tie a line to its
request, and reads the level from the stream; our server writes everything
to stderr, so every line shows as an error. Two small changes fit the logs:
errors to stderr and the rest to stdout, and Vercel's request id on each
line. Vercel's trace view takes application spans only from its Node
package, so our server's spans (it has none yet) go to a backend of our
own, which a trace drain can feed with Vercel's spans too. The log part
landed the same night: `instrumentation.log.output` and
`instrumentation.log.request_headers` in the server, set by the launcher on
Vercel, and the control plane logging the same way. Evidence:
[observability.md](observability.md).

<a id="c45"></a>

### C45 · Previews share the home and the control plane · superseded by C46

Each preview has its own schema in each region's database ([C8](#c8)), but
the home's database URL names its schema and the control plane's schema is
always `cloud`, so every preview uses the same two. Why: one account works
on every preview, and it was the simpler shape while the MVP's previews came
from one branch. The cost: one preview's migrations reach every preview;
goose skips versions it already knows, so two pull requests that add the
same migration number break each other's preview. The launcher refuses
`CLOUD_SCHEMA=cloud`. Open: a schema per preview for the home and the
control plane, before the project is connected to Git, which would give
every pull request a preview. Evidence: the review of PR #1518;
`apps/cloud/launcher/database.go`, `apps/cloud/internal/deployment/migration.go`.

## Schemas and Git (2026-10-11)

<a id="c46"></a>

### C46 · Every deployment has schemas of its own · holds

Every deployment has a schema base, and each role's schema derives from it,
so no two deployments share a schema, production included. Supersedes
[C45](#c45).

| Deployment | Base |
|---|---|
| production | `zitadel_nextgen`, the server's default schema |
| a preview | `CLOUD_SCHEMA` (a CLI upload), else `pr_<pull request id>`, else `br_<branch>` |

| Role | Schema | Database |
|---|---|---|
| a region | `<base>` | its region's |
| the identity home | `<base>_home` | Frankfurt |
| the control plane | `<base>_cloud` | Frankfurt |

- **The URLs carry no schema.** The launcher replaces any `schema=` a
  database URL names, so production and the previews can share the same
  database variables without sharing a schema.
- **A local run** (outside Vercel) uses its URLs as configured, and the
  control plane keeps `cloud`.
- **`CLOUD_SCHEMA` may not end in `_home` or `_cloud`.** The old rule, the
  launcher refusing `CLOUD_SCHEMA=cloud`, is gone.
- **The control plane's migration files still say `cloud.`** The qualifier
  is rewritten to the deployment's schema as the files are read, and its
  queries are qualified the same way.

Why:

- **Previews get fresh accounts**, Florian's choice ("fresh per preview").
  A preview's home starts empty and imports the Preview target's admin
  document (`BOOTSTRAP_ADMIN_USER_JSON_B64`), so one known account signs in
  on every preview.
- **The migration hazard of C45 is gone:** a preview's migrations reach only
  its own schemas.
- **Production can run on the preview databases** during the proof of
  concept ([C47](#c47)).

Evidence: `apps/cloud/internal/deployment/schema.go`,
`apps/cloud/launcher/database.go`, `apps/cloud/api/migrate.go` and
`store.go`; commit `b731d970`.

<a id="c47"></a>

### C47 · Until the merge, production deploys from the pull request's branch · holds until the merge

The proof of concept deploys from Git: every push to PR #1518's branch
deploys production, previews are off, and production runs on the preview
databases, team only. Florian approved the Vercel settings on 2026-10-11;
the runbook's
[undo at the merge](https://github.com/zitadel/nextgen/blob/claude/nextgen-deployment-research-3b5ebe-code/docs/runbooks/preview-cloud.md#undo-at-the-merge)
reverses them.

| Setting | Value |
|---|---|
| Git | connected to github.com/zitadel/nextgen |
| Production branch | `claude/nextgen-deployment-research-3b5ebe`, PR #1518's head branch |
| Preview deployments | off (`previewDeploymentsDisabled`) |
| Ignored Build Step | `[ -n "$VERCEL_GIT_COMMIT_REF" ] && [ "$VERCEL_GIT_COMMIT_REF" != "claude/nextgen-deployment-research-3b5ebe" ]` |
| `CLOUD_PRODUCTION_BRANCH` (Production) | the same branch |
| Deployment protection | Vercel Authentication on every domain (`all`) |

- **Only that branch builds.** The Ignored Build Step skips a build from any
  other branch: `main` and the other pull requests have no root
  `vercel.json`, so building them would deploy the bare repository.
- **Only that branch migrates production.** The migrate step allows
  production only from `CLOUD_PRODUCTION_BRANCH`, default `main`
  (`deployment.ProductionBranch`, `CheckMigrationAllowed`).
- **Production runs on the preview databases** (`eu-preview`, `us-preview`)
  in the schemas `zitadel_nextgen`, `zitadel_nextgen_home` and
  `zitadel_nextgen_cloud` ([C46](#c46)), with the Production target's own
  master key and admin document. The six database variables and `PORT`
  apply to both targets.
- **The data is disposable:** Florian expects to redo it several times.
- **Team only:** Vercel Authentication covers every URL, the production
  domain `nextgen-preview-cloud.vercel.app` included. The earlier setting,
  `all_except_custom_domains`, left that domain public: Vercel counts a
  project's production domain among the domains it exempts.
- **CLI previews** (`deploy-preview.sh`) are turned off with previews.
- **The smoke test runs on every deployment** Vercel reports ready
  (`.github/workflows/cloud-smoke.yml`) and shows as a check on the commit.

What it gives: production from Git, with the migrate guard and production's
schemas, before the merge. Until then the cloud's `vercel.json` exists only
on PR #1518's branch, so no other branch can deploy the cloud. The first
production deployment from Git failed on the image's tag, fixed the same
night ([C32](#c32)). Evidence: the project's settings in Vercel;
`apps/cloud/internal/deployment/migration.go`;
`.github/workflows/cloud-smoke.yml`.

## The docs on Next.js (2026-10-11)

<a id="c48"></a>

### C48 · The docs are a Next.js app, and everything they serve is under /docs · holds

The docs moved from Fumapress on Waku to Fumadocs on Next.js, set up as
Fumadocs' [Next.js installation](https://www.fumadocs.dev/docs/manual-installation/next)
does it ("as standard as you can", Florian), the stack zitadel.com/docs runs on.
They stay a service of their own rather than pages of the website. The
cloud now routes `/docs` and `/docs/(.*)` to them and nothing else:

| Was ([C6](#c6)) | Now |
|---|---|
| `/reference/api/…` | `/docs/reference/api/…` |
| `/llms.txt`, `/llms-full.txt` | `/docs/llms.txt`, `/docs/llms-full.txt` |
| `/mcp` | `/docs/mcp` |
| `/api/search` | `/docs/api/search` |
| `/assets/…`, `/RSC/…` | `/docs/_next/…` |

- **The pages keep their URLs.** Fumadocs serves `content/docs` at `/docs`;
  only the API reference moved, into it.
- **`assetPrefix`, not `basePath`.** `assetPrefix: "/docs"` moves the
  scripts and styles under `/docs/_next/`, apart from the website's
  `/_next/`, as Next's multi-zones guide does. A `basePath` would have
  moved the pages to the app's root, and every URL written outside a Next
  link (in `llms.txt`, the Markdown, the MCP answers) would miss `/docs`.
- **Two departures from the standard layout.** Search, `llms.txt` and the
  MCP server sit under `app/docs/` rather than the app's root. The MCP
  server is written out, because Fumadocs' own (`fumadocs-core/mcp`) needs a
  release from last week; it is stateless, where Fumapress kept its
  sessions in one function's memory.
- **The Markdown is the page now.** A page's `.md` and `llms-full.txt` held
  the search index's text, without code blocks; an API operation's `.md`
  was empty. Now a page's `.md` is its Markdown and an operation's is the
  operation with every schema it references.
- **`DOCS_SITE_URL` is gone:** only Fumapress's sitemap and image plugins
  read it, and neither was on.

Evidence: `apps/docs/next.config.mjs`, `vercel.json`, the docs steps of
`apps/cloud/scripts/smoke.mts`.

<a id="c49"></a>

### C49 · The frontends report page views and speed to Vercel · holds

The docs, the website and the console send Vercel Web Analytics (page
views) and Speed Insights (how fast pages load), as Florian asked. Both
set no cookies. The storybook does not: it is a workbench for the team.

- **The console only in the cloud's build.** The console the Go server
  embeds runs where nothing serves Vercel's scripts, so the cloud's build
  sets `VITE_CONSOLE_VERCEL_INSIGHTS=1` (in `vercel.json`) and only that
  build contains them. The console reports the matched route
  (`/console/users/$userId`), so a screen's numbers add up across the
  resources it shows.
- **Cost:** Web Analytics is billed per page view, $0.03 per 1,000 on Pro,
  and is enabled once per Vercel project (on for `nextgen-preview-cloud`).
  Speed Insights' free tier costs nothing: 10,000 events in 30 days,
  shared by the team, and the Real Experience Score only.

Evidence: the root layouts of `apps/docs` and `apps/website`,
`apps/console/src/components/vercel-insights.tsx`.

## Gates (2026-10-11)

<a id="c50"></a>

### C50 · Production moves only after the deployment's checks pass · proposed, blocking after the merge

Vercel's Deployment Checks can hold a production deployment off the
production domain until GitHub checks pass. Two are configured on the
project: `smoke` (every service's API) and `journeys` (`apps/cloud-e2e`: the
docs, and in the console a sign-up, a project in each region, a rename, sign
out and in), the jobs of `.github/workflows/cloud-smoke.yml`. They run on
the deployment's own URL, as Vercel's guidance has it.

**They report but do not block yet** (`blocks: none`). Holding failed twice
on 2026-10-11:

- **A skipped job counts as passed.** Every Vercel project of the repository
  sends its `deployment_status` to the workflow, and each skipped job left a
  check of its name on the commit: b762df27 went live a second after it was
  ready. A job now carries the name only on the run for the cloud's ready
  deployment.
- **A held deployment never starts its checks.** Vercel creates GitHub's
  deployment, and with it `deployment_status`, only when it promotes, so
  the workflow waited for a promotion that waited for the workflow
  (43c8c64f, promoted by hand). Vercel's trigger for Deployment Checks is
  `repository_dispatch` (`vercel.deployment.ready`), which GitHub runs only
  from workflows on `main`.

So blocking comes with a workflow on `main` triggered by that event, at
the merge or in a pull request of its own; the runbook's undo list has the
step. Migrations run before the checks, in the build ([C9](#c9)): a failing
check keeps the previous deployment serving on the new schema, which
expand-and-contract makes safe. The journeys sign up a new account per run
and leave it, and its two projects, behind: no API deletes a project yet.

Evidence: the project's checks (`GET /v2/projects/<id>/checks`), the check
runs of b762df27 and 43c8c64f, `apps/cloud-e2e`, the workflow.

<a id="c51"></a>

### C51 · A server refuses a database that lacks its migrations · holds

A server started without `--migrate` reads the migration history before it
serves, and refuses to start when its database lacks a migration it ships
(`database.ErrNotMigrated`). Before, it started and failed request by
request ([C9](#c9)); now such a deployment fails its first request and its
smoke test, and once the checks block, the domain stays where it was
([C50](#c50)). A database ahead of the binary passes, so the previous
deployment keeps serving a newer schema. The check only reads: goose's own
creates its version table when it is missing, which the servers' role may
not do. Spanner checks only in the builds that can migrate it
(`spanner_integration`).

Evidence: `internal/storage/dialect/migrated`, `startDatabase` in
`cmd/server/server.go`.
