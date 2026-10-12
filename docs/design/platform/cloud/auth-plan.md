# Cloud auth plan, 2026-10-10: one session, many deployments

> **Status:** plan, not started; the product team's work
> ([C24](decisions.md#c24), [C35](decisions.md#c35)). How sign-in works
> today: the [README](README.md). What today's cookie lookup exposes between
> the home and each region: [security.md](security.md).
>
> **What:** the home signs short-lived tokens for each region instead of
> the regions asking it about the shared cookie, and teams work across
> regions.
>
> **Checked** on 2026-10-11 against other products and the standards:
> [research](auth-research.md). Its eight changes are folded in below.

Follow-up to [2026-10-09-cloud-plan.md](history/2026-10-09-cloud-plan.md). Two
questions came out of reading the two-region layout, and this note answers
both as a plan: how the browser's sign-in at the identity home reaches a
region and the control plane **securely** (today the session cookie is
forwarded), and how **authorization** works when the people and their teams
live in the home while the projects live in the regions, one team holding
projects in several of them.

The short version. The cookie stays at the home and goes nowhere else. Every
other deployment gets a short-lived token the home signs for exactly that
audience, carrying who the person is, which teams they hold and which
platform roles they have. A region keeps deciding access with its own grants
(ADR 053: the grant lives on the protected project, the principal is foreign)
and expands a team grant through the token's team list instead of membership
rows it does not have. Five phases, each verifiable on the preview; an ADR at
the end.

## 0. What runs today

Verified in the code on 2026-10-10:

- **The cookie.** `__nextgen_session`: `HttpOnly`, `Secure` on https,
  `SameSite=Lax`, `Path=/`, host-only (`sessionCookie` in
  [internal/api/session.go](../../../../internal/api/session.go)). Its value is
  the session token, a JWE under the home's token key, valid as long as the
  session (`session.max_ttl`, 30 days by default). The CSRF token is an HMAC
  keyed by the cookie value ([csrf.go](../../../../internal/api/csrf.go)), so
  whoever holds the cookie can compute it.
- **A region** cannot decrypt the cookie. With `platform.home.url` set,
  `HomeSessionResolver` ([homesession.go](https://github.com/zitadel/nextgen/blob/claude/nextgen-deployment-research-3b5ebe-code/internal/api/homesession.go))
  forwards it to the home's `GET /sessions/me` (and `GET /users/me` on first
  sight), caches the answer 60 s under `sha256(cookie)`, synthesises a
  session, provisions a **shadow user** with the home's id and attributes
  into the region's platform project and gives it a personal team. The
  request then carries a user principal whose home project is the region's
  platform project (`proj_platform`, the same constant id the home uses).
- **The control plane** (`/cloud`) does the same lookup, and for
  `POST /cloud/projects` forwards the cookie to the region's `claim/complete`
  with a CSRF token it computes itself
  ([apps/cloud/api/regions.go](https://github.com/zitadel/nextgen/blob/claude/nextgen-deployment-research-3b5ebe-code/apps/cloud/api/regions.go)).
- **Authorization in a region** is ADR 053/054 as implemented: assignments on
  the protected project; a `team` principal expands through
  `authz_membership_edges` in the principal's home project, in the **same
  database** (`writeFoothold`, `writeMembershipEdgeMatch` in
  [resolver_sql.go](../../../../internal/storage/dialect/authz/resolver_sql.go)).
  The home's teams and memberships are in another database, so a home team
  cannot be a grant principal a region can resolve. That is why a claim in a
  region attaches to the shadow's personal team, and why ownership is per
  region today.

## 1. What is wrong with forwarding the cookie

The cookie is a bearer credential with no audience and the lifetime of the
session. Forwarding it makes every deployment on the host a full holder of
it.

| Exposure | Consequence |
|---|---|
| A region, the control plane, and every static app on the host receive the cookie on every request (`Path=/`, one host). | One compromised or buggy deployment (a log line, an SSRF, a dependency) yields a credential valid at the home for `PATCH /users/me`, `DELETE /sessions/me`, management writes there, claims in **every** region, and the CSRF token that goes with it. The blast radius of a region is the whole cloud. |
| The home cannot tell a region's lookup from the browser's own call. | Audit at the home attributes server-originated reads to the person; a leaked cookie replays identically. |
| The home is in the request path of every uncached regional call. | Home down means regions down after 60 s; revocation reaches a region when its cache expires. |
| One host is one origin. | An XSS in the docs, the website or storybook is an XSS in the console: same-origin JS can call the home and the regions as the signed-in person. `SameSite` and CSRF do nothing against same-origin script. |
| The name carries no `__Host-` prefix. | Harmless on `*.vercel.app` (a public suffix). On a custom domain a sibling subdomain could set a `Domain=` cookie of the same name and shadow ours. |

None of this is wrong for a preview. All of it is wrong for a product with
support staff, dedicated customers and a residency promise.

## 2. Decision (1): the cookie stays at the home; a signed, audience-bound token travels

### The token

A **home token**: a signed JWT, header `typ: at+jwt` (RFC 9068), minted by
the home for one audience, five minutes long. ADR 037 already has this class
for third-party edges; this makes it the first-party cross-deployment
credential too.

```json
{
  "iss": "https://cloud.example",          // the home's issuer, exactly
  "sub": "user_01…",                       // the home's user id
  "aud": "https://cloud.example/eu",       // one region's public base, or the control plane's
  "client_id": "console",                  // who asked: console, cli, cloud
  "exp": 1760000300, "iat": 1760000000, "jti": "…",
  "auth_time": 1759990000, "amr": ["pwd"], // when and how the person signed in (security S11)
  "sid": "sess_…",                         // the home session
  "groups": ["team_a", "team_b"],          // active memberships, home ids, at most 50
  "owned_teams": ["team_a"],               // active team.owner assignments
  "roles": ["support"],                    // platform roles, §3, empty for customers
  "act": { "sub": "svc_cloud" }            // only on delegated tokens, §2 server to server
}
```

The claim names are RFC 9068's: `groups` and `roles` are the SCIM names it
recommends; `owned_teams` is ours, as no standard has one. Ids only, no names
or emails: the token is not a directory. Above 50 memberships `groups` is
left out and `"groups_overage": true` says so, never a shortened list; the
region then reads the person's team ids from the home (the directory read of
§3) once and keeps them until `exp`. That is Entra's pattern; 50 ids make a
token of 3.1 KB, 200 would make 10.6 KB on every request
([research](auth-research.md) §2).

Signed with the platform project's `token` signing key, which exists
(`signing_keys`, `KeyService.GetProjectSigner`); what does not exist yet is
the JWKS endpoint, so the home grows `GET /.well-known/jwks.json` serving
the platform project's active and grace-period keys with the lifecycle of
ADR 039 (propagation window = the `Cache-Control` max-age the regions
honour), and `GET /.well-known/oauth-authorization-server` (RFC 8414) naming
the issuer and that `jwks_uri`.

### Minting

`POST /sessions/me/tokens` `{ "resource": "https://cloud.example/eu" }` →
`{ "access_token", "token_type": "Bearer", "expires_in": 300 }`, an OAuth
token response. `resource` is RFC 8707's: one public base per request, one
audience per token. Cookie-authenticated, user-bound, unsafe (so the origin
guard and the CSRF token apply, ADR 053 §5, as RFC 10017 requires for exactly
this endpoint), rate-limited, resources restricted to the configured
`platform.regions` and the control plane. The home re-reads the user's
status, memberships and `team.owner` assignments at mint time, so only an
active user gets a token and the claims are fresh at `iat`. A session the
home has revoked mints nothing.

This is RFC 10017's **token-mediating backend**, with the issuer and the
backend in one server: the cookie does what the refresh token does there.
RFC 10017 prefers a backend that proxies every call and asks for a reason
against it; ours is that region traffic must not run through Frankfurt (see
Rejected). The risk it names stays: script running in the console can mint
region tokens while the session lives. The defences are in this section:
tokens in memory, one audience each, five minutes, a CSP, and the console on
an origin of its own in phase 5.

### Verification in a region

New region config: `platform.home.issuer` (defaults to `platform.home.url`;
the region finds the `jwks_uri` in the home's RFC 8414 metadata). The
audience a region answers to is its own public base, which it already knows.
The security handler accepts a bearer that is a JWS from that issuer with
`typ: at+jwt`: verify the signature against the cached JWKS (refetch once on
an unknown `kid`), require `aud` to be the region's public base, `exp` in the
future, `iss` exact, and, from phase 2, no pushed removal that names the
token (§3). It mints the
same `ScopeContext` the cookie path mints today (user principal, home project
`proj_platform`) plus the team set of §3, and the same remote session for
`mySession`. Project secrets keep their JWE path untouched; the token
service distinguishes the two by header.

No cookie means no CSRF: a bearer in a non-simple header is not sent by a
cross-site form. The origin guard still runs and passes.
`userBoundSessionOperations` and the OpenAPI security declarations gain the
scheme for the operations the console calls in a region. A region publishes
`/.well-known/oauth-protected-resource` (RFC 9728) naming the home, so the
CLI and agents find where to get a token.

### The console

The SDK already carries a per-handle bearer
(`createZitadelClient({baseUrl, token})`, `apiForRegion` in
[zitadel.ts](../../../../apps/console/src/api/zitadel.ts)). Platform mode adds
a token cache per audience: mint on first use, refresh at 80 % of `expires_in`
or on a 401, drop on sign-out and on a session change (`pageUserId`). Tokens
live in memory only, never in storage or URLs, and never go to the home. The
console never reads a token's content (RFC 9068 §6); who the person is and
their teams come from the home. Region calls stop sending the CSRF header; the
cookie still rides along to a region on the same host until phase 5 moves
regions to their own hosts, and the region ignores it once the bearer is
present (the bearer wins, as it does today for dual-scheme operations).

What this changes for XSS: nothing for the worse. Same-origin script could
already call the regions with the ambient cookie; now what it can steal is
bounded to five minutes and one region, and the only long-lived credential
stays `HttpOnly`.

### Server to server

The control plane never sees a cookie again:

- **Acting as the person** (listing their projects across regions, reading
  usage): the console calls `/cloud` with a token for the control plane; the
  control plane exchanges it at the home for a region token (RFC 8693 token
  exchange: `subject_token` = the person's token, `actor_token` = its own
  credential, `resource` = the region) and gets back the person's claims plus
  `act: {sub: "svc_cloud"}`. The region authorizes as the person, audits the
  actor, accepts only the actors on its list, and decides on the person and
  the current actor only (RFC 8693); ADR 048 already names a token-exchange
  event for exactly this.
- **Provisioning** (create a project in a region for a team): a static
  provisioning credential the region knows by hash
  (`platform.provisioning.keys`), good for one operation, `POST /projects`
  with `owning_team_id`, and nothing else. The owning team comes from the
  person's `owned_teams` and the control plane checks it before calling. No
  create → `claim/init` → `claim/complete` dance with a borrowed cookie; the
  claim flow stays for the CLI, where a developer owns a project secret.

Both are credentials of a named, individually scoped principal in the sense
of ADR 053 §9, without inventing a general platform-key principal type: one
is a delegation that carries the person's own authority, the other is bound
to one operation.

The actor credential is only as separate as its Vercel project. Inside one
project every function reads every secret and Vercel's OIDC token names no
service, so `act` attributes a call and proves nothing. Once the control
plane is a project of its own (security S1), its actor credential is its
Vercel OIDC token, checked by `project_id` and `environment` and never a
development token, and no static secret is left to steal
([research](auth-research.md) §5).

### Transition and hardening

- The cookie lookup (`platform.home.url` as it works today) stays behind
  `platform.home.accept_cookie: true` for one release, default `false` after
  the console mints tokens. The resolver code is reused as the token path's
  session synthesiser.
- `__Host-Http-` prefix on the cookie name whenever `Secure` is set, as
  RFC 10017 asks: `__Host-` plus a guaranteed `HttpOnly` (Chrome 140,
  Firefox 143; Safari and older browsers apply the `__Host-` rules). The name
  is a constant in the SDKs and the api-mock; the `http://localhost` Safari
  allowance keeps the unprefixed name, since the prefix requires `Secure`.
- A `Content-Security-Policy` for the static apps on the host (console,
  docs, storybook, website) through `vercel.json` `headers`, before anything
  renders third-party content next to a session.
- Session lifetime at the home: review `session.max_ttl` for the console
  (30 days is a lot for an operator console).

### Rejected

- **Keep forwarding, shorten the cache.** Does not change what a region
  holds, nor the coupling.
- **Scope the cookie by path (`Path=/eu`).** A path is not a security
  boundary (same-origin script, no audience), and it would need one cookie
  per region at sign-in.
- **A parent-domain cookie across region hosts.** Widens exposure to every
  host under the domain, impossible on `*.vercel.app`, and still a bearer
  with no audience.
- **DPoP (RFC 9449) now.** Binding the token to a browser key stops replay
  of a stolen token; worth adding once the SPA has a WebCrypto key per
  session, not needed to replace the cookie. Audience and five minutes come
  first. RFC 10017 calls it hard for this pattern, and it does not stop
  script in the page; server-to-server tokens would be bound first.
- **A gateway that swaps the cookie for a token on every request** (Linear,
  Atlassian, Netflix, Google IAP, Cloudflare Access). On Vercel the gateway
  is Routing Middleware: JavaScript at every edge, no bindings, not inside a
  service. The CLI and the control plane need region tokens anyway, so it
  would be a second path to the same token.
- **Federation: each region an OpenID relying party of the home** (Shopify,
  Grafana Cloud). It needs an OpenID provider at the home and a regional UI
  with a session of its own; the regions are headless, the console is one
  app, and cookies across sites break on a dedicated customer's domain.
- **The control plane as the only gateway to the regions.** Discussed on
  2026-10-10: an extra Frankfurt hop for every US request, a residency
  problem, and the region must enforce anyway.

## 3. Decision (2): the home asserts identity and teams, the region decides

The test case: a team in the home owns projects in the EU and in the US, its
owners administer all of them, an access team of that account edits one US
project, a support engineer may read every project. Where each fact lives:

| Fact | Source of truth | How a region learns it |
|---|---|---|
| Who the person is, whether they are active | Home | `sub` (only active users get tokens) |
| Which teams they participate in, which they own | Home (`team_memberships`, `team.owner` assignments) | `groups`, `owned_teams` in the token |
| Which team owns a project | **Region**, `owning_team` assignment on the project, principal = home team id (ADR 053 §2, D13) | Its own row |
| Project roles granted to home users or teams | **Region**, `authz_assignments` on the project | Its own rows |
| Platform roles (support, operator) | Home, an explicit grant with expiry (ADR 053 §9) | `roles` in the token |
| Which region a project lives in | Control plane, `placements` | Directory only, never authority |

Nothing moves. Grants stay on the protected project in the region (ADR 033's
residency invariant), teams stay in the home. The one new thing is where a
team grant's **membership expansion** comes from.

### The resolver takes an asserted principal set

A region finds a person's teams in membership rows of its own database. It
has none for the home's teams, so it takes them from the token.
`domain.AuthzCheckParams` gets `PrincipalTeams`, `PrincipalOwnedTeams` and
`MembershipAsserted bool`. When asserted, the SQL writer's team arm becomes
`a.principal_type = 'team' AND a.principal_id IN (teams)` instead of the
`EXISTS` over `authz_membership_edges`, and the owner-of-owning-team
derivation (ADR 054 §3: `admin ⊇ owner from owning_team`) becomes
`a.relation = 'owning_team' AND a.principal_id IN (owned_teams)`. Lists use
the same params through `WriteListAuthzExistsPredicate`, so check and list
stay equivalent (ADR 033). Standalone deployments, where the home is the
same database, keep the edge path untouched: one resolver, two sources for
the same relation, chosen by whether the credential asserted its memberships.

This is a bounded contextual principal set, not the unbounded contextual
tuples ADR 032 forbids: at most 50 team ids in the token, matched by indexed
`IN`; above that the explicit overage of §2 and the home's list, cached until
the token expires. The shape has precedents: AWS Verified Permissions turns a
groups claim into the principal's parents and OpenFGA passes it as contextual
tuples, both capped near 100 ([research](auth-research.md) §2).

### Projects attach to home teams

- `POST /projects` (provisioning credential) and `claim/complete` take the
  explicit `team_id` ADR 054 §7 asks for; the server accepts it only when it
  is in the caller's `owned_teams`. The shadow personal team goes away.
- Grants written in a region name home principals by id or locator
  (ADR 054 §4). The region validates existence and activity at write time
  through a home directory read (`GET /directory/principals/{id}`, exists,
  active, display label; authenticated by the region's own credential), and
  relies on the token's assertions at check time.
- The shadow user stays, as a **label projection** (audit actor display, grant
  principal expansion), refreshed from the directory, never consulted for
  authorization. It keeps the id and a display label, none of the attributes
  it copies today (security S10): account data stays in Frankfurt, and a
  region receives the ids of the people who act there
  ([research](auth-research.md) §6). ADR 053 §8: friendly labels are a
  separately authorized projection. ADR 053 rejects a shadow user in every
  protected project; this is one per region, in the region's platform project,
  with no credential and no say in access.

### Platform roles

At the home, an explicit object (`deployment`, scope kind platform) with
relations `support` and `operator`, granted with an expiry by a home operator
and audited. The token carries the role names in `roles`; the token's `exp`
never exceeds the grant's, and a revocation is pushed (below). A region maps
them through config,
`platform.home.roles: { support: viewer, operator: admin }`, applied to every
project, so support can read everywhere and gets `403` on writes. Every
allowed request under a platform role writes the ADR 048 event in the
customer's project with `authorization.path = "platform_role"` and the role,
so the customer sees it. A dedicated deployment refuses them with an empty
map. Consent, break-glass and impersonation stay with #333.

### Listing projects across regions

Each region's `ListAuthorizedProjects` takes the asserted set and answers
the union ADR 053 §6 defines, with `effective_role` and `sources`
(ADR 054 §9). The control plane aggregates with delegated tokens so the
console makes one call; `placements` tells it which regions hold the
person's teams' projects, so it does not fan out blindly, but a project
appears in the list only when the region says so.

### Revocation and staleness

| Event at the home or in a region | Effect | Latency |
|---|---|---|
| Sign-out, session revoked | No new tokens; the pushed event refuses the existing ones | seconds; ≤ 5 min if the event is lost |
| User deactivated | The same | seconds; ≤ 5 min |
| Removed from a team, `team.owner` revoked | The region drops the team from older tokens; the next token lacks it | seconds; ≤ 5 min |
| Platform role revoked or expired | The same, for the role | seconds; ≤ 5 min |
| Grant revoked in a region | Immediate | 0 |

Five minutes alone would be the price of not calling the home per request:
as good as any vendor's ([research](auth-research.md) §3), but looser than
ADR 053 §4, which denies the next request after a removal, and too loose for
a support role. So the home **pushes removals**. On a sign-out, a
deactivation, or a removed membership, ownership or platform role, it posts a
Security Event Token (RFC 8417, in the shapes of OpenID's CAEP:
`session-revoked`, claims changed) to each region (RFC 8935 push). A region
keeps each event for one token lifetime and refuses, for what the event
names, every token issued before it; the console then mints a fresh one.
Best effort, with no outbox and no queue: a lost event falls back to the five
minutes. One table per region, rows deleted after five minutes, one indexed
lookup per request.

Destructive and owner actions ask for a recent sign-in, not a recent token:
the region answers `401` with `insufficient_user_authentication` and a
`max_age` (RFC 9470), reading `auth_time` from the token, and the console
signs the person in again at the home.

### Relation to the ADRs

ADR 053 holds: foreign principals, grants on the protected project, home and
target scope kept apart, the denial contract. Three amendments: membership
expansion may come from a home-asserted set when the home is another
deployment; §4's denial on the next request becomes a denial within seconds
through pushed removals, five minutes when an event is lost; and the "mint a
target-project token for every Console switch" alternative, rejected for the
single deployment and left open for the federated one, is now the federated
shape. ADR 036's credential table gets a row (home token: operator-plane
credential for a human, five minutes, audience-bound, `at+jwt`). ADR 037 gets
a first-party self-contained class. ADR 039's JWKS endpoint ships. Proposed as
an ADR under the next free number, **Identity home tokens and cross-deployment
authorization**, written from §2 and §3 once this plan is agreed.

## 4. Phases

| Phase | What lands | Depends on | Size |
|---|---|---|---|
| 0. Hardening of what runs | `__Host-Http-` cookie on https; CSP headers for the static apps; audit field `authorization.path = "home_session"` on cookie-vouched requests; `session.max_ttl` review | – | ½ day |
| 1. Home tokens | JWKS endpoint and RFC 8414 metadata; `POST /sessions/me/tokens` with `resource`; the RFC 9068 claims, `auth_time` and `amr` included; region verification with `platform.home.issuer` and its own public base as the audience; RFC 9728 metadata in the regions; console token cache per audience; cookie path behind `accept_cookie`; tests (`homesession_test` → token tests, `active-api.spec`) | – | 3–4 days |
| 2. Teams in the token | `groups` (at most 50, then the overage and its lookup) and `owned_teams` claims; `AuthzCheckParams` principal set and the SQL arms in `resolver_sql.go` with `stmttest` on Postgres, SQLite, Spanner; `team_id` on provisioning create and `claim/complete`; shadow personal team removed, shadow attributes dropped; directory read for grant-time validation; pushed removals (about a day) | 1 | 4–5 days |
| 3. Control plane without cookies | Provisioning credential and `POST /projects` with `owning_team_id`; token exchange at the home with `act`, and an actor list in the regions; the actor credential becomes the control plane's Vercel OIDC token once it is a project of its own (security S1); `POST /cloud/projects {name, region, team_id}` and `GET /cloud/me/projects` aggregated; console reads the control plane | 1, 2 | 2–3 days |
| 4. Platform roles | Grant object at the home; `roles` claim; region mapping and audit; step-up (RFC 9470) for owner actions; console banner "support access"; dedicated opt-out | 2 | 2–3 days |
| 5. Hosts and boundaries | Regions on their own hostnames (`has: [{type: host}]` routing, verified in the spike), CORS allowlist = the console origin, cookie never leaves the home host; docs and website on their own hosts | a domain | 1–2 days |

Phases 0 and 1 can start now. Phase 5 waits for a custom domain, since
`*.vercel.app` cannot carry the split; until then the regions stay under
path prefixes and the bearer is what keeps the cookie irrelevant to them.

## 5. Open for decision

- `SameSite=Strict` on the cookie, as RFC 10017 asks: a link into the
  console from another site would then land signed out.
- Where the platform-role grants are administered: the home's own grant API
  on the `deployment` object (proposed) or the control plane.
- The directory read for grant-time validation: a home endpoint (proposed)
  or the control plane re-exporting the home's teams.
- Whether the docs' "try it" samples (asked on 2026-10-10) mint region
  tokens the same way; the mechanism allows it, the product question is open.
