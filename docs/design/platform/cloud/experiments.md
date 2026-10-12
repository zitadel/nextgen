# Cloud experiments, 2026-10-07 to 11: what was tried and what came out

> **Status:** the index of every concept tested or researched for the cloud,
> one row each, with its result and where it stands. The measurements are in
> the notes each row links to; the reasons are in [decisions](decisions.md).
> Dates are 2026.

Read a row as: the concept, how it was tested, what came out, what was
decided. "Research" means read and compared, not run.

## Databases

| Concept | Test | Result | Stands |
|---|---|---|---|
| **Neki**, PlanetScale's sharded Postgres | 10-07, PS-10 unsharded: the published `@zitadel/server@1.0.0-alpha.24` binary, `nextgen migrate`, API smoke, raw probes | Three blockers on the router: DDL inside a transaction is accepted and silently lost (goose cannot create its table); correlated subqueries (every authz check) refused; data-modifying CTEs (user create) refused. All messages say "yet" | Rejected ([C1](decisions.md#c1)); re-test when Neki announces the three. [Journal](history/2026-10-07-preview-cloud-journal.md#neki-findings-2026-10-07-ps-10-unsharded-aws-eu-central-1-postgres-186-neki) |
| **PlanetScale Postgres** | 10-07, PS-5, `eu-central-1`, same binary and probes | All 27 migrations, boot, seeded create, authz query, the multi-insert CTE: green. From a US laptop a user create took 3.7 s (151 ms per round trip, about 20 round trips); from `fra1` 0.23 s | Holds ([C1](decisions.md#c1), [C3](decisions.md#c3)) |
| **CockroachDB** across three regions | 10-09, a Basic cluster (Frankfurt primary, two US regions), about 100 lines of textual migration rewrite | Connects after the rewrite (no advisory locks, no `COLLATE "C"`, no hash partitions, no `btree_gin`, other trigger syntax), but DDL took 2 s, 48 s and 47 s for the first three migration files; stopped at the fourth | Rejected ([C16](decisions.md#c16)); nothing in the repo. Only a single-region cluster would be a fair re-test |
| **A schema per preview**, not a database | 10-08, `search_path` on the connection string, then `schema=` | PgBouncer rejects `search_path` as a startup parameter, so the schema became a parameter the server reads and never sends; every statement qualifies its objects | Holds ([C8](decisions.md#c8), [C10](decisions.md#c10)) |
| **PgBouncer against the direct port** under a burst | 10-08, 24 concurrent seeded creates, cluster at 25 connection slots, then 50 | Direct port: 11 to 13 of 24 fail (connection slots exhausted, instances die at boot). PgBouncer: 24 of 24 once an instance is warm; server-side connections flat at 13 | Holds ([C10](decisions.md#c10)): serve on 6432, migrate on 5432. [Journal](history/2026-10-07-preview-cloud-journal.md#back-to-the-container-through-pgbouncer-2026-10-08-evening) |
| **Pool size per instance** | 10-10, P1 of the routing POC: 50 to 200 concurrent requests with 4 connections, then 1 | 4: no failures, p50 0.20 s, p99 0.5 to 1.5 s. 1: the same to 100, then requests stall past 60 s at 150 and 200 | 4 per pool, 2 to 4 per dedicated system ([C29](decisions.md#c29)). [Systems §12](systems.md#12-poc-results-2026-10-10) |

## Compute

| Concept | Test | Result | Stands |
|---|---|---|---|
| **Cloudflare Containers**, first design | 10-07, research | A Worker plus a Durable Object per replica, hand-built routing, no autoscaling, a documented cold-start p95 near 24 s, region-level placement | Dropped for Vercel ([C2](decisions.md#c2)) |
| **Vercel container image** from GHCR | 10-07, first deploy, `fra1` | Build 13 s, cold start 3.7 to 5.3 s, warm `/readyz` 0.19 s, user create 0.23 s: 16 times faster than from a laptop. Egress on 5432 with TLS works | Proved the platform ([C2](decisions.md#c2), [C3](decisions.md#c3)) |
| **Go preset against the container** | 10-08, same commit, side by side | Build 156 s against 370 to 403 s; cold start 0.31 to 0.45 s against 2.3 s; warm the same | Go preset ([C11](decisions.md#c11)) |
| **Fan-out and failures under a burst** | 10-08 evening, 24 concurrent creates on both runtimes | A cold burst starts 24 instances on either runtime; the failures were the database's connection slots, first misread as the Go preset serving one request per instance | Container ([C12](decisions.md#c12)), reversed next day |
| **Go preset against the container, again** | 10-09, both through PgBouncer with 50 slots, 48 concurrent `/readyz` from idle | Go preset p50 0.73 s, container 3.2 s; both zero failures; build 2 min against 8 min (72 CPU-minutes); the server's own boot is 140 ms either way | Go preset ([C14](decisions.md#c14)) |
| **Cloudflare Containers**, re-tested | 10-08 night, a Worker in front of a fixed pool of two containers, same preview database, [removed 10-09](history/2026-10-07-preview-cloud-journal.md#cloudflare-containers-spike-2026-10-08-night-removed-2026-10-09) | Works: smoke green, 72 of 72 concurrent creates, PgBouncer flat at 8 connections. Slow: a seeded create 1.8 to 2.2 s against 0.35 s on Vercel, bursts 3 to 7.6 s per request. Cause: placement is region-level, the containers landed in Madrid, 25 to 30 ms from Frankfurt, times about 60 round trips per create. A bigger instance changed nothing; Hyperdrive is a Workers binding a container cannot use | Rejected ([C13](decisions.md#c13)); reopen with city-level placement |
| **Containers after all** | 10-10, the containers plan's T2, T4, T5, T6 | T2: a container service pinned to `cle1` answers from `cle1`. T4: `SIGTERM` with 30 s at scale-in; the server drains (the Go preset gets no signal). T5: image 74 to 90 s per deployment, cold 2.1 to 2.5 s in `fra1`, no failures at 200 concurrent, warm 590 to 760 requests per second with p99 0.7 s against the preset's 540 and 1.44 s. T6: service bindings reach the home, unreachable from the internet | Holds ([C31](decisions.md#c31) to [C33](decisions.md#c33)). [Containers plan](history/2026-10-10-containers-plan.md) |
| **Keep-warm cron** | 10-09, 120 five-minute pings of a container | 94 of 120 landed on a cold instance anyway; a warm instance bills its memory around the clock, about $22 a month | Removed ([C15](decisions.md#c15)) |
| **Cost** | 10-09, the usage page for two days and about eight deployments | $5.25: builds $3.95 (about $0.50 per push, all services), memory $1.16 (the cron), CPU $0.14. At 100 million requests a month, $430 to $840 in `fra1` | Accepted for a preview cloud. [Journal](history/2026-10-07-preview-cloud-journal.md#what-two-days-cost-2026-10-09) |
| **Fly, Render, Railway, GCP** for always-on servers | 10-10, [research](provider-fit.md) | Fly has the best routing and the weakest record; Render the strongest record and no programmable routing; Railway no Frankfurt region; GCP the strongest routing and the most operations. The half-day experiment per provider was not run | Stay on Vercel ([C30](decisions.md#c30)) |

## Regions and routing

| Concept | Test | Result | Stands |
|---|---|---|---|
| **Two regions in one project** | 10-09 and 10, `/eu` in `fra1`, `/us` in `cle1`, a database each | `x-vercel-id` shows the region; a project exists only in its region's database; a secret shown to the other region gets 401. Per-function regions come from `.vc-config.json` written by the build (a service's `functions` key is ignored for the Go preset). Warm from San Francisco: seeded create EU 0.40 s, US 0.29 s | Holds ([C17](decisions.md#c17)). [Journal](history/2026-10-07-preview-cloud-journal.md#two-regions-and-an-identity-home-2026-10-09-and-10) |
| **Hosts per region against path prefixes** | 10-09, both shapes deployed | Host routing works (`has: host`). Paths won: `*.vercel.app` is a public suffix, so no cookie spans two hosts, and one host needs no CORS | Paths ([C18](decisions.md#c18)); hosts return with tokens and a domain ([auth plan](auth-plan.md) phase 5) |
| **Stripping the prefix** | 10-09 and 10 | For the Go preset a route in front of the catch-all with a `request.path` transform; for a container service a plain rewrite in the service's own `rewrites`, where the transform does nothing | In `build-output.sh` ([containers plan](history/2026-10-10-containers-plan.md), T2) |
| **Project routing rules** for dedicated customers | 10-10, the routing POC R1 to R5 on a throwaway project | All pass: a rule by host and one by path reach different slots, carry a header the client cannot override on the matched host, take effect without a deployment and survive one; a rule-routed request costs nothing extra (0.20 s either way). R6, routing to an older deployment, was not run | Concept ([C26](decisions.md#c26)); POC removed ([C41](decisions.md#c41)). [Systems §12](systems.md#12-poc-results-2026-10-10) |
| **A database per system**, P1 | 10-10, `acme` as a service, then `beta` and `gamma` through rules carrying a sealed database address | Each project answers only where it was created (sixteen checks, a clean diagonal); a forged or misplaced envelope gets 400; opening a system 35 to 190 ms per instance; an envelope 1.3 KB | Proven and taken out ([C43](decisions.md#c43)); fix S3 and S4 before it returns. [MVP plan](history/2026-10-10-mvp-plan.md#p1-a-distinct-database-per-system) |
| **Service bindings** for internal calls, T6 | 10-10 | A binding reaches the caller's own deployment past deployment protection; its host resolves publicly to a reserved address and times out from the internet; 15 to 75 ms within `cle1`, 130 to 210 ms to `fra1`. The last call, a create through a binding by a signed-in person, has run in the [journeys](https://github.com/zitadel/nextgen/tree/claude/nextgen-deployment-research-3b5ebe-code/apps/cloud-e2e) on every deployment since 10-11 | Holds ([C33](decisions.md#c33)) |

## Identity

| Concept | Test | Result | Stands |
|---|---|---|---|
| **One sign-in for every region**: the regions ask the home about its cookie | 10-10 | `GET /eu/sessions/me` and `/us/sessions/me` answer the home's session, 0.8 s on a region's first call and 0.1 to 0.2 s cached; a project created and claimed in each region with it | Holds, interim ([C19](decisions.md#c19)); what it exposes: [security](security.md) |
| **Home tokens** instead of the cookie | 10-11, [research](auth-research.md) against standards and products | The plan is RFC 10017's token-mediating backend, as Clerk, WorkOS, Auth0 and Entra do it; teams in the token as Verified Permissions and OpenFGA do; eight details changed (50-team cap, pushed removals, step-up, `__Host-Http-` cookie, RFC 9068 claims) | Proposed ([C24](decisions.md#c24)), [auth plan](auth-plan.md) |

## Releases and checks

| Concept | Test | Result | Stands |
|---|---|---|---|
| **Migrations in the build**, P3 | 10-10 | A migrate step pointed at nothing failed the build and the deployment never went live; a rollback across an additive migration rehearsed on a throwaway schema; the control plane migrates in the build too | Holds ([C9](decisions.md#c9), [C38](decisions.md#c38)). [MVP plan](history/2026-10-10-mvp-plan.md#p3-migrations-end-to-end) |
| **A server refuses a schema behind it** | 10-11, `go test` and the deployments since | A fresh database is refused and left untouched; a migrated one starts; a newer schema passes | Holds ([C51](decisions.md#c51)) |
| **Checks on every deployment** | since 10-11 | `smoke` (every service's API, 24 steps) and `journeys` (Playwright: the docs, sign-up, a project in each region, rename, sign out and in) run on each deployment's own URL and report; blocking waits for the merge | Holds ([C50](decisions.md#c50)) |

## Project shape

| Concept | Test | Result | Stands |
|---|---|---|---|
| **Vercel Services** against a wrapper project or Microfrontends | 10-08 | Services: one deployment, one route table, no extra hop; the docs service built in 2 min next to the server's 3 s | Holds ([C5](decisions.md#c5)) |
| **The docs under `/docs`** | 10-08 Waku `basePath`, 10-11 Next.js | Waku's Vercel adapter left files at the root, so the move needed a patch script and 40 moved files: reverted. Next.js's `basePath` makes it free | Holds ([C48](decisions.md#c48)) |
| **Observability on Vercel** | 10-10, [research](observability.md) | Logs attach to a container's instance, not its request; traces come from Node only; so JSON logs split by stream, ids on every line, the backend still to choose | Logs hold, the backend is open ([C40](decisions.md#c40), [C44](decisions.md#c44)) |
