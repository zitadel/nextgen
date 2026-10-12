# Security between the home and the regions, 2026-10-10

> **Status:** review of the MVP as built on 2026-10-10, against the code of
> PR #1518 and the project's configuration. Three findings are fixed with
> it (S6, S12, S13). Since then one more was found and fixed (S14), S7 is
> narrowed and S8 partly mitigated. Two are
> [parked with systems](#parked-with-systems) (S3, S4,
> [decision C43](decisions.md#c43)) and come back with them; the others are
> ordered at the end.
>
> Since 2026-10-11 production runs as a proof of concept: team only, on the
> preview databases, on disposable data ([C47](decisions.md#c47)). "Before
> production" below means before production takes customers.

Two words used below: a **Vercel environment** is Production or Preview,
each with its own variables (the runbook's "target"); the **admin file** is
the first platform admin's account with a password hash
(`BOOTSTRAP_ADMIN_USER_JSON_B64`).

**Verdict.** For a protected preview the shape is acceptable: the transport
is sound and projects stay in their region. It is not yet a shape for
customers, because two things are wider than the design assumes: every
function holds every secret of its Vercel environment (S1), and the home's
cookie reaches every service on the host (S2). Before production, fix S1
with S5, then S7 and S8. Fix S2 before any customer gets a database of their
own. S3 and S4 are parked with systems and must be fixed before systems
return.

## What crosses between the home and a region

| # | Path | Carries | Who vouches | Protected by |
|---|---|---|---|---|
| 1 | Browser → a region (`/eu`, `/us`) | the home's session cookie (host-only, `Path=/`), the CSRF token on writes | the region asks the home (2), and accepts only sessions of the home's platform project | TLS; `SameSite=Lax`; the region's origin and token checks |
| 2 | Region → home, `GET /sessions/me` and `/users/me` | the person's cookie | the home's answer | a service binding: Vercel's internal network, TLS, not reachable from the internet |
| 3 | Control plane → home | the person's cookie | the home's answer, for sessions of the platform project only | a binding |
| 4 | Control plane → region: create, claim challenge, claim completion | the person's cookie, a CSRF token it derives from the cookie, the new project's one-time secret | the region asks the home | a binding |
| 5 | Vercel → every function of a Vercel environment | every variable: all database addresses, every migrator address, the master key, the admin file | – | the environment (Production or Preview); the launcher drops what its server does not need |

Sound as built: bindings use TLS and do not resolve from outside (public DNS
answers 192.0.2.1); databases are reached with `verify-full`; a project's
secret is a 401 in any other region; production and preview values live in
separate Vercel environments. The exception: while production runs on the
preview databases ([C47](decisions.md#c47)), the database variables apply
to both, so production and the previews are apart by schema, not by
credentials; the master key and the admin file stay per environment. While
systems were in the code (removed,
[C43](decisions.md#c43)), a routing rule also carried a customer's database
address to a region (`X-Nextgen-System`); S3 and S4 are about that path.

## Findings

| # | Severity | Finding | Fix | Status |
|---|---|---|---|---|
| S1 | High in production | Every function holds every secret of its Vercel environment | The servers of each region in a project of their own; the frontends in a project with no secrets | open |
| S2 | High before dedicated databases | The home's cookie reaches every service on the host | The auth plan's tokens; then the cookie stays away from the regions | open |
| S5 | Medium | One master key for the home and every region | A key per region and one for the home | open |
| S6 | Medium | The control plane accepted cookie writes without CSRF checks, then derived the region's token itself | The regions' rule: same origin and the session's token | **fixed** |
| S7 | Medium | The home serves the whole product API in public | Only the routes the console and the lookups need | open, narrowed by S14 |
| S8 | Medium-low | The session lookup amplifies and its caches only grow | Cache refusals, collapse concurrent lookups, bound the caches | open, partly mitigated |
| S9 | Low | Bindings carry no identity | Test undeclared callers; token exchange for server calls | open |
| S10 | Low | The shadow copies a person's attributes into every region they use | Shadow the id and a label only | open |
| S11 | Low | A region reports a fresh password factor for every home session | Carry the home's factors and time | open |
| S12 | Low | The control plane passed region errors to the browser | The code at most; details to the log | **fixed** |
| S13 | Low | Dead bypass plumbing; a migrator address left in the serving environment | Removed; the variable deleted | **fixed** |
| S14 | Medium | A region accepted a home session of any project at the home | Accept only the platform project's sessions | **fixed** |

S3 and S4 are [parked with systems](#parked-with-systems).

### S1 · Every function holds every secret of its Vercel environment

Vercel gives every function of a project every variable of its Vercel
environment ([decision C20](decisions.md#c20)). On the preview that is every
regional database address, every migrator address (roles that can run DDL),
the master key and the admin file, in the EU and US servers, the control
plane, and the functions of the docs (server rendering, search, an MCP
endpoint) and of the website, whose code has nothing to do with them. The
launcher drops what its server does not need, but only from the process's
own copy of the environment: the kernel keeps the environment the process
started with, readable in `/proc/self/environ`, so any file-read bug in any
function reads all of them. The control plane drops nothing.

Fix for production: the servers of each region in a Vercel project of
their own, holding only their database and key, and the frontends in a
project without secrets, composed on one host by rewrites (the shape kept as
plan B in [C17](decisions.md#c17)); the cost is that calls between projects
leave the bindings. The auth plan's tokens shrink that cost, since a region
then no longer calls the home on every request
([auth research](auth-research.md) §5). Until then, the launcher can re-exec itself with only
what the server needs, which empties `/proc/self/environ` (half a day).

### S2 · The home's cookie reaches every service on the host

One host, `Path=/`: every region, the control plane and any function of the
docs or the website receive a bearer that is valid at the home and in every
region for the session's lifetime. A compromised region is the whole cloud
([auth plan §1](auth-plan.md)), and so would be a region serving a
customer's own database, once systems return. One more consequence of one
host: every nextgen server on it sets the same cookie name with `Path=/`, so
a region that sets or clears a session cookie replaces the home's.

Fix: the [auth plan](auth-plan.md)'s phase 1, five-minute tokens per
audience, so the regions stop needing the cookie; then the home moves to a
host of its own or to a prefix its cookie is scoped to, so the browser stops
sending it to the regions.

### S5 · One master key everywhere

Within a Vercel environment the home and every region share one key: the one
that wraps the home's signing and encryption keys at rest also sits in the US
function. Fix: a key per region and one for the home; with S1's split this is
just configuration, in one project it needs a key variable per database key
in the launcher.

### S6 · The control plane's writes lacked CSRF checks · fixed

`POST /cloud/projects` accepted the cookie with no origin check and no token,
then called the region with a token it derived from the cookie, so the
regions' check meant nothing on that path. `SameSite=Lax` blocks it across
`vercel.app` hosts; on a custom domain a sibling subdomain is the same site.
The control plane now applies the regions' rule (`apps/cloud/api/csrf.go`):
`Sec-Fetch-Site` or the origin against the forwarded host, and the session's
token in `X-Zitadel-CSRF`, which the console already sends; a refusal is the
regions' `403 auth.csrf_invalid`, on which the console fetches a fresh token.

### S7 · The home serves the whole product API in public · narrowed

The home is the catch-all of the host, so anonymous `POST /projects` and every
other route of the product answer from the database that holds every account;
the smoke test created its projects there until 2026-10-10.

Narrowed since the review by [S14](#s14): a session of a project someone
creates at the home no longer counts as a cloud account in a region or at
the control plane. What stays open: the home still answers every route of
the product, anonymous project creation included, and anyone can still sign
up at the home and so get a cloud account.

Fix: route only what the console's account flows, the runtime document and
the regions' lookups need to the home, and refuse the rest at the edge (a
route list in `vercel.json`, or a server mode). Half a day to a day.

### S8 · The session lookup amplifies and its caches only grow · partly mitigated

A region asks the home about every cookie it cannot read itself; nothing
caches a refusal and nothing limits the calls, so cookies sent to `/us` turn
into load on the one home in Frankfurt. Partly mitigated since the review: a
region asks the home only when the cookie's key is not one of its own, and a
cookie the home vouched for a moment ago skips that key lookup. Random
cookies no longer reach the home; a crafted cookie shaped like the home's
token (a JWE) still does. The caches keep only successes, and drop an entry
only when it is looked up again; the control plane's never drops one. Fix: cache refusals for a few seconds,
collapse concurrent lookups of one cookie, bound both caches, rate-limit at
the firewall. Half a day; obsolete once the tokens of S2 land.

### S9 · Bindings carry no identity

A region cannot tell the control plane from a browser, and the home cannot
tell a region's lookup from the person's own call, so audits attribute server
calls to the person. A binding's address follows from the project id and the
service name; whether a function that declares no binding can call it is
untested. Fix: test it; the auth plan's token exchange gives server calls an
identity (`act`).

### S10 · The shadow copies a person's attributes into every region

A region provisions the person from the home's `GET /users/me`, all
attributes included, so an EU account's email lands in the US database on its
first call there: a transfer the residency promise has to name. Fix: shadow
the id and a display label only, which is where the auth plan heads.

### S11 · A region reports a fresh password factor

The session a region synthesizes from the home's answer claims a password
factor verified at the moment of the lookup, whatever the person used and
whenever. Nothing gates on it today; audit and any step-up would read it
wrong. Fix: carry the home's factors and authentication time.

### S12 · Region errors reached the browser · fixed

The control plane returned the region's error text, and on a transport error
the binding's internal address. It now answers the region's error code at
most and logs the rest with the region's request ids.

### S13 · Leftovers · fixed

The launcher and the control plane still carried a protection-bypass header
for calls to the home and the regions, for a secret the project no longer
sets since bindings carry those calls; removed. The serving launcher dropped
the regional migrator addresses but not the plain `CLOUD_MIGRATOR_DATABASE_URL`
the Preview environment still held. It dropped it until the variable was
deleted on 2026-10-11 (the runbook's
[bring production up](https://github.com/zitadel/nextgen/blob/claude/nextgen-deployment-research-3b5ebe-code/docs/runbooks/preview-cloud.md#bring-production-up)),
and no longer needs to.
The server's `platform.home.headers`, which could carry the bypass header to
the home, is gone too.

<a id="s14"></a>

### S14 · A region accepted a home session of any project · fixed

Found and fixed in the round of fixes after the review. The home answers
`GET /sessions/me` for a session of any of its projects, and a region took
every such answer. So anyone who signed up at the home in a project of their
own became a platform user in every region, with whatever attributes that
project let them set, and could take another person's unique attributes
there, such as an email address. Now the region's `Resolve`
(`internal/api/homesession.go`) refuses any session whose `project_id` is
not the platform project, and the control plane does the same
(`apps/cloud/api/home.go`).

## Parked with systems

Systems, a customer's own database, left the code on 2026-10-10
([C43](decisions.md#c43)). These two findings were written while systems were
in the code, and are the first thing to fix when they return.

| # | Severity | Finding | Fix | Status |
|---|---|---|---|---|
| S3 | High once systems return | The envelope is encrypted, not authenticated | Seal with a secret only key holders have; add an expiry | parked (C43) |
| S4 | Medium once systems return | Envelopes never expire and open on any path of their region | Expiry and re-seal (with S3); rotate a system's password when it leaves | parked (C43) |

### S3 · The envelope is encrypted, not authenticated · parked

The envelope is a JWE with `RSA-OAEP-256`: sealing needs only the master
key's public half, and the [systems concept](systems.md) §3 plans to hand
exactly that to the provisioning job. Whoever has the public key can mint an
envelope that points a region at any database: the region connects to that
host, serves the database's content under the cloud's origin, and unwraps
with the real master key whatever wrapped keys it finds there, so a signing
key stolen from a real database in its wrapped form becomes usable again.
It was not exploitable, since the public key existed only next to the
private one.

Fix: authenticate the envelope with a secret only the sealer and the regions
hold: JWE `dir` with `A256GCM` under a key derived from the master key
(HKDF with a label of its own), or a signature by a key only the control
plane holds; and an `exp`, with the control plane re-sealing. Half a day to
a day.

### S4 · Envelopes never expire and open on any path of their region · parked

A rule overwrites `X-Nextgen-System` only on its own path; on `/eu/…` a
client's header passes through
([systems](systems.md) §12, R4). So a captured envelope keeps reaching its
system after the rule is gone, until the database's password or the master
key changes, and every server of the region opened it (`server_eu` and
`system_acme` alike). A system that leaves needs its database password
rotated; the expiry of S3 closes the rest.

## Order

1. **Done:** S6, S12, S13 with this review; since then S14 fixed, S7
   narrowed, S8 partly mitigated.
2. **Before production:** S1 with S5, then S7 and S8. Until S1, the
   launcher's re-exec narrows it.
3. **Before any customer gets a database of their own:** S2, the auth plan's
   phase 1 and the cookie away from the regions; S3 and S4 when systems
   return.
4. **With the product team:** S9, S10, S11.
