# Cloud systems, slots and routing, 2026-10-10 (concept)

> **Status:** concept, not in the code. The cloud as it runs is in the
> [README](README.md).
>
> **What:** a region's server also serves customers' own databases, picked
> per request by a routing rule, with no deployment.
>
> **History:** layers 1 and 2 of the routing contract passed a proof of
> concept on 2026-10-10 (§12). Layer 3 was built as an app per system
> ([C36](decisions.md#c36)) and proven with `acme`, `beta` and `gamma` (the
> [MVP plan](history/2026-10-10-mvp-plan.md)'s P1). It left the code the
> same night, since nothing needs it yet ([C43](decisions.md#c43)). The
> code lives only in PR #1518's history: `git fetch origin pull/1518/head`,
> then `git show 602d0ae0` lists what left, which came in with `8b6d0adf`,
> `1ae4e897` and `b04537ed`. Fix S3 and S4 of the
> [security review](security.md) before it returns. Versions as slots (§4),
> migrations on promotion (§5) and the control plane's jobs (§8) were never
> built. Below, read "is" as "would be".

Where this comes from: the dedicated-customer discussion of 2026-10-10, after
the [auth plan](auth-plan.md) and the two-region layout of
[2026-10-09-cloud-plan.md](history/2026-10-09-cloud-plan.md). The question was how a
function in a region picks a customer's database, and it turned into the
operating model of the cloud. Written down so the idea is not lost; the POC
at the end is what proves it on Vercel before nextgen changes.

The thesis in one sentence: **a region is a name with a placement and a
database, and a dedicated customer is a region with one customer in it.**
Compute is per placement and is code. Everything else is a row, and a
routing rule. A customer who needs their own compute or their own release
calendar self-hosts the same binary.

## 1. Vocabulary

| Term | Meaning | Example |
|---|---|---|
| **System** | A nextgen with its own database, keys and platform project. Its name never changes. | `eu`, `us` (shared), `acme` (dedicated) |
| **Placement** | The Vercel function region next to a database. | `fra1`, `cle1` |
| **Slot** | One placement at one version: one service in `vercel.json`, pinned to its region through `.vc-config.json`. | `server_eu` (latest), `server_eu_pinned` (pinned) |
| **Rule** | A project routing rule mapping a host and/or a path to a slot, carrying the system's sealed envelope. | host `auth.acme.com` → `/eu/…` |
| **Envelope** | The system's identity and DSN, encrypted to the master key, sent as a request header by the rule. | `x-nextgen-system: eyJ…` |
| **Directory** | The control plane's `systems` table: name, kind, owner team, placement, slot, database reference, flags. | schema `cloud` |

Shared regions are systems whose database holds many projects; a dedicated
system holds one customer's projects. To the home, the console and the
token audience of the auth plan, both are a region entry with an API base.

## 2. The routing contract

Three layers, each with one owner, so that "why did this request go there"
has one answer.

**Layer 1, slots, static.** `vercel.json` has one rule per slot and nothing
per customer. A slot is reached by its path prefix on any host the project
serves, and strips it with the `request.path` transform the regions use
today:

| Path | Slot | Region |
|---|---|---|
| `/eu/…` | `server_eu`, latest | fra1 |
| `/eu-v1.2/…` | `server_eu_pinned`, pinned | fra1 |
| `/us/…` | `server_us`, latest | cle1 |

A request that reaches a slot with no envelope is served from the
placement's shared database, which is what `/eu/…` does today.

**Layer 2, rules, dynamic.** One project routing rule per dedicated system,
managed through the Vercel API with staging, publish and rollback, in effect
immediately, no deployment. A rule matches **a host and/or a path**, rewrites
to the slot, and sets the envelope header:

| Customer form | Match | Rewrite | Header |
|---|---|---|---|
| Own host | host equals `auth.acme.com` | `/eu/:path*` | envelope of `acme` |
| Our host, path | path `/sys/acme/:path*` | `/eu/:path*` | envelope of `acme` |

Both forms exist because both are wanted: a customer whose own app fronts
the API pastes `https://cloud.example/sys/acme` once and needs no domain; a
customer whose login we host needs `auth.acme.com`, its own origin and
cookie jar. The same rule can carry both matches. Moving a customer to
another placement or version is editing the rewrite target; the name stays.

**Layer 3, the server, decides nothing about placement.** As built
(`1ae4e897`, removed by [C43](decisions.md#c43)), it opened the envelope,
checked that the system was placed in its own region, and served it from an
app of the system's own ([C36](decisions.md#c36)). Not a pool per system
inside one app: the signing-key cache is keyed by project id, and the
platform project's id repeats in every database. An envelope that did not
open, or named another region, got a 400. That is not enough: anyone with
the public key can seal an envelope (S3), and a captured one outlives its
rule (S4). The rule's header action overwrites whatever the client sent on
a matched host.

Routing Middleware is not in the contract. Vercel's own guidance prefers
static configuration where no custom code is needed, and none is; it stays
the upgrade if a decision ever needs code (a flag read, an experiment).

## 3. The sealed envelope

Why it is sent and not looked up: a slot built last month must serve a
customer onboarded today, so no deployment may need to know the customers.
Why it is sealed: a DSN in clear on every request would sit in logs and
traces, and a header the runtime trusted would let anyone who reaches the
function point it at a database of their choosing.

- **Format.** JWE compact serialisation, `RSA-OAEP-256` + `A256GCM`, to
  the master key the launcher already renders into `server.master_keys`
  (`MASTER_KEY_PEM_B64`, `MASTER_KEY_ID` as `kid`). Payload:
  `{ "v": 1, "system": "acme", "placement": "fra1", "dsn": "…", "iat": … }`.
- **Who seals.** The provisioning job, which holds the public key only.
  *Revised by the [security review](security.md) (S3): a sealer that needs
  only the public key is what makes an envelope forgeable, so the envelope
  is to be sealed with a secret only the sealer and the regions hold, and
  carry an expiry.*
- **Who opens.** The slot, with the private key it already has for its own
  encryption at rest. Decrypted once per instance per ciphertext (cache by
  hash of the ciphertext); the pool is keyed by a hash of the DSN.
- **Rotation.** A new DSN password is a new ciphertext in the rule. A master
  key rotation is a re-seal of every rule under the new `kid` while the
  runtime holds both keys, which `master_keys` already allows.
- **Size.** About 1.3 KB as built; the request header limit is 16 KB.

The master key is the one secret that must stay the same across
deployments. It already is.

## 4. Versions are slots

A pinned version is a service built from a release binary next to the
freshly built latest: `server_eu_pinned` and `server_eu`, both in fra1
(service names may not contain digits, §12). The
build script fetches the tagged binary instead of compiling; everything
else about the service is identical. The pinned set lives in `vercel.json`,
reviewed in pull requests, bounded by the 100-service limit.

Chosen over Vercel's deployment history (routing a pinned customer to an
older deployment URL) because a request then passes one route table in one
deployment, reproducible with `vercel build` locally, with no protection
bypass, no second CDN pass and no dependency on retention. Deployments stay
what Vercel made them: the rollback unit for the whole alias.

Pinning is a dedicated-system feature. The shared regions share one schema
and run latest only; their gradual story is Vercel's rolling releases, by
percentage.

## 5. Migrations

The slot that will serve a database is the one that migrates it.

- **Shared systems** keep migrating in the `migrate` service's build step
  from env, as today.
- **Dedicated systems** are not in env, so they migrate on promotion: the
  control plane calls the target slot's internal migrate endpoint with the
  system's envelope and a deploy secret; the slot runs its embedded
  migrations under the advisory lock; then the rule flips. Onboarding is
  the same call against an empty database, followed by bootstrap of the
  platform project and keys.
- **Window.** Migrations stay expand-and-contract across the supported
  window (latest and two pinned versions), so a rule can be rolled back
  without touching data. Slots outside the window are removed from
  `vercel.json`, not kept routable.

## 6. Pools and PgBouncer

Every PlanetScale database sits behind PgBouncer, and the number of server
connections is what runs out first: instances × pools × connections per
pool. With many systems per placement this is the bottleneck in scaling
cases.

- Per-system pools hold **two to four connections**
  ([C29](decisions.md#c29)): `pool_max_conns` on the DSN, which
  `pgxpool.ParseConfig` already honours; `pool_max_conn_idle_time` short,
  so idle systems release their connections. One connection stalled past
  60 s at 150 concurrent requests (§12).
- Pools are opened lazily, kept in an LRU per instance, closed when idle.
- The shared regions keep their current pool size.

## 7. Behaviour per system: flags

Placement and database are routing, never flags. Behaviour is: new features
ship dark behind a flag, enabled per system or owner team on the
customer's schedule, killed per customer in an incident. The console, docs
and website use Vercel Flags directly; the Go runtime reads its switches
from the envelope or the directory, so no second store sits in the request
path.

## 8. What changes in the control plane

- The region list (`CLOUD_REGIONS` today) becomes a `systems` table (name,
  kind, owner team, placement, slot, database reference, flags, status);
  `placements` keeps project → system.
- A provisioning job: database in the placement's region, system row, seal,
  migrate through the slot, bootstrap, rule staged and published, home
  directory refreshed.
- A promotion job: migrate through the target slot, edit the rule, publish;
  rollback is the previous rule version.
- The home's `platform.regions` reads the directory instead of a static env
  var, and the token audiences of the auth plan are the system names.

## 9. Accepted

Every system in a placement shares a process, so a region-wide incident is
one for dedicated customers too, and every function in a placement can open
every envelope routed to it, since all hold the master key. Per-system
fields on every log line and event, pool caps and connection timeouts keep
one customer's database outage from exhausting an instance, and the
firewall rate-limits by host or path. Full isolation is self-hosting.

## 10. Research findings this rests on (Vercel docs, 2026-10-10)

- A function deployed to several regions is routed to the region closest to
  the request; nothing steers it per request. Routing to a chosen region
  means routing to a function pinned there.
- `has` host conditions take regex captures and `pre`/`suf`/`re` objects;
  `transforms` set request headers and the path at the CDN.
- Project-level routing rules run before the deployment's routes, match host,
  header, cookie, query and path, rewrite internally or externally, set
  request headers, are staged, published and rolled back by API, and do not
  run Routing Middleware.
- Routing Middleware runs on the Node.js runtime globally before the cache;
  it is not supported inside a service.
- Service bindings are internal URLs for code, skip firewall and protection,
  do not authenticate, cannot be declared by Go-runtime callers (container
  images can), and cannot be used from middleware. Nothing here needs one.
- Secure Compute binds a project environment to one private network in one
  region; a project cannot have private networks in two regions. If
  VPC-peered customer databases become part of the offer, that is a project
  per placement, independent of everything above.

## 11. POC

Goal: prove layers 1 and 2 on Vercel with a hello-world, then the pool
setting with the real server, before any nextgen change for layer 3.

**Setup.** A separate Vercel project (`nextgen-routing-poc`) from a
throwaway directory in the repo (`apps/cloud/routing-poc/`, removed on
2026-10-10 once the results below were recorded). One Go program that answers every request with JSON:
`slot`, `VERCEL_REGION`, `VERCEL_DEPLOYMENT_ID`, host, `x-forwarded-host`,
the path it observed, the `x-nextgen-system` header, and all request
headers. Built the way the regions are built (`build-output.sh` shape,
`.vc-config.json` with `regions` and an `environment` carrying `SLOT`), as
three services:

| Service | Region | `SLOT` | Stands for |
|---|---|---|---|
| `hello_eu` | fra1 | `eu` | latest |
| `hello_eu_v1` | fra1 | `eu-v1` | a pinned version, same source, different build |
| `hello_us` | cle1 | `us` | another placement |

Static rules: `/eu-v1/(.*)`, `/eu/(.*)`, `/us/(.*)`, each stripping its
prefix.

**Tests.**

| # | What | Pass |
|---|---|---|
| R1 | Project rule: host equals `acme-poc.vercel.app` (a `.vercel.app` name added to the project) → rewrite `/eu/:path*`, set `x-nextgen-system: sealed-acme` | `hello_eu` answers from fra1 with the header and the stripped path |
| R2 | Project rule: path `/sys/acme/:path*` → rewrite `/eu-v1/:path*`, same header | `hello_eu_v1` answers; the two forms reach different slots by rule alone |
| R3 | Edit R2 to `/eu/:path*`, publish | takes effect without a deployment, within seconds |
| R4 | Client sends its own `x-nextgen-system` on the R1 host, and on the generic host | overwritten on the matched host; passes through on the generic host (the runtime's decrypt is what refuses it) |
| R5 | Deploy a second time, repeat R1 | the rule survives the deployment and the new deployment serves it |
| R6 | Optional: rule → external rewrite to the previous deployment URL with the bypass header expanded from `VERCEL_AUTOMATION_BYPASS_SECRET` | works or not; informs whether deployment history is a fallback |
| P1 | Real `server_eu` on the preview with `pool_max_conns=1`, 50–200 concurrent requests to a database-touching endpoint, then with `4` | p95 and PgBouncer errors for both; decides the default per-system pool size |

R1 to R5 are half a day including the project. P1 is an hour against the
existing preview. If R1 or R2 fail, the fallback is generating the rules
into `vercel.json` at build time from the directory, which keeps the
contract and loses only the no-deploy onboarding.

**After the POC**, in order: the envelope package and the pool router in
nextgen with the launcher flag (two to three days), then the control plane
jobs and rule management (two to three days), then versions as slots in the
build script. The auth plan's phases are unchanged and run alongside. (Layer
3 was then built as an app per system, [C36](decisions.md#c36), and removed,
[C43](decisions.md#c43); the rest was not built.)

## 12. POC results (2026-10-10)

Run the same day against `nextgen-routing-poc` (production target, domains
`nextgen-routing-poc.vercel.app` and `acme-poc-zitadel.vercel.app`) and,
for P1, the preview cloud.

| # | Result |
|---|---|
| Slots | `/eu` → fra1, `/eu-v1` → fra1, `/us` → cle1, prefixes stripped, one deployment id for all three. Service names may not contain digits (`^[a-z]([a-z_-]*[a-z])?$`), so the pinned slot is `hello_eu_pinned`. |
| R1 | **Pass.** Project rule, host equals `acme-poc-zitadel.vercel.app` → `/eu/:path` with `x-nextgen-system` set: the eu slot answers with the clean path and the header. |
| R2 | **Pass.** Project rule, `/sys/acme/:path*` → `/eu-v1/:path` with the header: the pinned slot answers. Host and path forms reach different slots by rule alone. |
| R3 | **Pass.** Editing the rules (the destination had to be `/eu/:path`, not `/eu/:path*`, which appends a literal `*`) and promoting took effect on the next request, no deployment. |
| R4 | **Pass.** A client-sent `x-nextgen-system` is overwritten on the matched host; on the generic host it passes through, which is why the runtime trusts only what decrypts (not enough: anyone with the public key can seal, S3). |
| R5 | **Pass.** A redeploy kept the rules; the new deployment id shows in every answer. |
| Latency | A rule-routed request costs the same as a direct one (0.20–0.21 s from the test client to fra1 for both). |
| P1 | Baseline (pgxpool default, 4 connections): 0 failures at 50, 100 and 200 concurrent, p50 0.20 s, p95 0.38–0.90 s, p99 0.5–1.5 s. `pool_max_conns=1`: identical at 50 and 100, but at 150 and 200 concurrent requests stalled past the 60 s client timeout, twice. One connection per instance queues all the requests an instance serves at once behind a single connection; **keep 4 as the default and size dedicated pools at 2 to 4**, with idle close and an LRU as the protection against sprawl. The database reported 4 current connections and a 50-connection ceiling after the baseline runs. |
| R6 | Not run. Versions as services is the decision; deployment history stays the alias rollback. |

So layers 1 and 2 of the routing contract hold on Vercel as designed, with
one syntax lesson (`:path` in the destination). Layer 3, the sealed envelope
served by an app per system, was built next ([C36](decisions.md#c36)) and
removed the same night ([C43](decisions.md#c43)).
