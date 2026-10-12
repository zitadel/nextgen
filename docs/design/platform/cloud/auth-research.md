# Auth research, 2026-10-11: how a sign-in and its teams reach the regions

> **Status:** research behind the [auth plan](auth-plan.md). It confirms the
> plan's shape and changes eight details, now folded into the plan
> ([C24](decisions.md#c24)). Sources were read on 2026-10-11; the dates given
> are the sources' own.
>
> **What:** how products with one account and regional data, and the
> standards, carry a sign-in from an identity home to a region, and how a
> region learns a person's teams.

The two questions:

1. **Forwarding.** A person signs in at the home. How does that reach a
   region and the control plane? Today a region receives the home's session
   cookie and asks the home (`GET /sessions/me`, cached a minute,
   [C19](decisions.md#c19)).
2. **Authorization.** People, teams and memberships live in the home;
   projects and their grants live in the regions; one team can own projects
   in both. How does a region decide when the membership rows are in another
   database?

## The short answer

- **Keep the plan's shape.** The cookie stays at the home. The console asks
  the home for a five-minute token per region, signed by the home, and a
  region checks it alone against the home's public key. The IETF published
  this pattern in 2026 as the *token-mediating backend* of RFC 10017, and it
  is how Clerk, WorkOS, Entra and Auth0 hand tokens to browser apps. Linear,
  Atlassian, Google IAP and Cloudflare Access mint the same kind of token at
  a gateway instead.
- **Keep the teams in the token.** The token lists the person's team ids, and
  the region expands its team grants from that list. AWS Verified
  Permissions and OpenFGA do exactly this with an identity provider's groups
  claim. Cap the list at 50 and look up above it, as Entra does above 200.
- **Push removals.** Five minutes until a removal takes effect is in line
  with every vendor below, and looser than our own rule (ADR 053 §4: the next
  request is denied). A small best-effort push from the home to the regions
  brings it to seconds, for about a day of work.
- **A token isolates only what Vercel isolates.** Every function of a Vercel
  project holds every secret, and Vercel cannot tell two services of one
  project apart. The regions are apart from the home only once they are
  projects of their own ([security S1](security.md)), and the tokens are what
  makes that split cheap.

## 1. How the sign-in reaches a region

| Way | Who does it | What a region receives | Here |
|---|---|---|---|
| **A.** Forward the cookie; the region asks the home | Us, today. Sentry's cells check its signed session cookie themselves, fetch the person from the global side, and drop that copy when the global side says so | the long-lived cookie | interim |
| **B.** The home mints a short token per region; the region checks it alone | Clerk (60 s), WorkOS (about 5 min), Entra and Auth0 (one token per API), Supabase (1 h, checked against published keys) | a token of minutes, valid only there | **the plan** |
| **C.** A gateway swaps the cookie for a token on every request | Linear (a Cloudflare Worker asks its auth service for a signed token and the region), Atlassian's isolated cloud, Netflix (Passport), Google IAP, Cloudflare Access, Vercel Passport (Enterprise) | the same kind of token | later, if ever |
| **D.** Federation: each region signs the person in through the home and keeps a session of its own | Shopify (Identity is an OpenID provider, every shop a relying party), Grafana Cloud, Elastic Cloud | a session of its own | no |
| **E.** No shared identity: an account per region | GitLab's cells today (a user lives on one cell), PostHog, GitHub's data-residency cloud, Zitadel Cloud's instances | everything | no |

Why B:

- **One kind of token for every caller.** The console gets it with the
  cookie, the CLI later through a device sign-in at the home, the control
  plane by exchanging the person's token (RFC 8693). A region checks one
  thing.
- **Any host layout.** A token in a header works whether a region sits under
  a path, on a subdomain or on a dedicated customer's own domain. Browsers
  block cookies across sites; Auth0 and Clerk both document the detours that
  costs them.
- **Nothing new in the request path.** C needs a gateway on every request. On
  Vercel that is Routing Middleware: JavaScript at every edge location,
  without bindings, not supported inside a service, and the routing concept
  chose none ([C26](decisions.md#c26)). D needs an OpenID provider at the
  home, which nextgen does not have, and a regional UI to sign in to; the
  regions are headless ([C22](decisions.md#c22)). E gives up the one account
  across regions the MVP keeps in Frankfurt
  ([MVP plan](history/2026-10-10-mvp-plan.md), D4).
- **Only the home can mint.** The home signs with a key only it holds; a
  region verifies with the public half. A secret all regions share, as
  Sentry's cells share theirs, lets any region mint sessions valid
  everywhere: the risk [security S5](security.md) already names for our one
  master key.

What B costs, as RFC 10017 puts it: script running in the console can ask the
home for fresh region tokens for as long as the session lives. A short
lifetime limits what it can carry away, not what it can do while it runs. The
defences are the plan's: the console on an origin of its own (phase 5), a
strict Content Security Policy (phase 0), one region per token, and the
origin and CSRF checks on the mint endpoint, which RFC 10017 requires there.
RFC 10017 prefers a backend that proxies every call and asks for a reason
against it. Ours: region traffic must not run through Frankfurt. A US request
would cross the Atlantic twice, and the home would carry every project's
data.

## 2. How a region learns a person's teams

| Way | Who does it | Check | A removal takes effect | Home down | Work |
|---|---|---|---|---|---|
| **a.** The teams travel in the token | AWS Verified Permissions (the groups claim becomes the principal's parents), OpenFGA (contextual tuples, at most 100), Entra (at most 200 groups, then a lookup), Okta (at most 100) | local | when the token expires | works until then | a cap and a lookup |
| **b.** Copy the memberships into every region | Sentry (outboxes), AWS IAM, Atlassian, Oso Cloud | local | after the copy: seconds, unbounded in an outage | works | outbox, relay, retries, backfill, deletes, reconciliation, lag alerts |
| **c.** Ask the home on every check | ADR 053 §2 accepted it for v1 | about 100 ms from Ohio per cache miss (estimate) | when the cache expires | fails | medium |
| **d.** One global authorization store | Google Zanzibar | local only for stale reads | only with consistency tokens (zookies) | needs three or more regions | the most: copies everything everywhere, against residency; CockroachDB is out ([C16](decisions.md#c16)) |

Established systems combine the first two: the caller's own groups in the
token, capped, with a lookup beyond the cap (Entra, Okta, Verified
Permissions, OpenFGA, Linear), and a read-only copy wherever a region must
resolve a directory with nobody asking (AWS IAM, Atlassian, Sentry).

**The plan's choice is a, and it holds**, with three refinements:

- **50 teams in the token, not 200.** With prefixed ULIDs and an ES256
  signature, 50 ids make a token of 3.1 KB and 200 make 10.6 KB, sent with
  every request. Vercel accepts 16 KB per header; common proxies default to
  8 KB. Vendors cap at 100 (Okta, OpenFGA, Verified Permissions) or 200
  (Entra); Clerk and Cloudflare keep custom claims near 1 KB.
- **The overage is explicit.** Above the cap the token carries a marker
  instead of a list, never a shortened list, and the region asks the home
  for the person's team ids once, cached until the token expires: Entra's
  pattern.
- **The resolver takes the set as input**, as the plan has it, so moving to b
  later changes where the set comes from and nothing else.

**When b becomes worth it:** the first feature where a region needs a team's
members without one of them asking: a background job acting for a team, a
notification to its members, "who can access this project", an access
review. Or the overage path turning common.

**The alternative many products take, and we don't:** a team lives in one
region, as Sentry's organization lives in one cell. Memberships are then
local, ADR 053 §4 holds as written and the token carries no teams. The price:
a team cannot own projects in two regions, so a customer with both needs two
teams. The plan keeps one team across regions, and a is cheap enough to
afford it.

## 3. How fast a removal takes effect

| | A membership removed | A session revoked |
|---|---|---|
| Clerk | within 60 s, the token's life | within 60 s |
| WorkOS | the token's life, about 5 min | on the next refresh |
| Entra | up to a day for group changes; tokens live 60 to 90 min | events within 15 min (Continuous Access Evaluation) |
| Google Cloud IAM | several minutes, potentially hours | – |
| AWS Verified Permissions | until the token expires; revocation "has no effect" | – |
| The cloud today | within 1 min, the lookup's cache | within 1 min |
| The plan | within 5 min | within 5 min |
| nextgen in one deployment | the next request (ADR 053 §4) | the next request (ADR 053 §5) |

Five minutes is as good as anyone's. It is looser than a single nextgen, and
a support role (plan §3) needs a hard stop.

**Proposal: the home pushes removals.** When a session ends, a user is
deactivated, or a membership, a team ownership or a platform role is removed,
the home posts a small signed event to each region. The region keeps it for
one token lifetime and refuses, for what the event names, every token issued
before it: a revoked session or a deactivated user loses the token, a removed
team drops out of the token's set, and the console mints a fresh one. The
shapes are standard. OpenID's Shared Signals and CAEP (final since September
2025) define `session-revoked` and claims-change events as Security Event
Tokens (RFC 8417), delivered by push (RFC 8935). Microsoft's Continuous Access
Evaluation runs on the same idea with day-long tokens, and Sentry clears its
regional copies of a person the same way.

Ours is best effort: no outbox and no queue, because the token's five minutes
stay the floor when an event is lost. In a region it is one table, a row per
event deleted after five minutes, and one indexed lookup per request in the
database the region queries anyway. About a day; it moves from "decided
later" into phase 2.

## 4. What the standards add

- **The request.** `resource` (RFC 8707) names the region by its public base
  URL, one per request. The answer is an OAuth token response
  (`access_token`, `token_type`, `expires_in`).
- **The token** (RFC 9068). Header `typ: at+jwt`. `iss`, `sub`, `aud`, `exp`,
  `iat`, `jti` and `client_id` are required; `auth_time`, `acr` and `amr`
  carry when and how the person signed in, which fixes
  [security S11](security.md). Teams go in `groups` and platform roles in
  `roles`, the SCIM names RFC 9068 recommends; owned teams have no standard
  name and keep one of ours. A region refuses any other `typ`, an `iss` that
  is not exactly the home's, and an `aud` that is not its own. The console
  never reads a token's content (RFC 9068 §6): who the person is and their
  teams come from the home.
- **Discovery.** The home publishes `/.well-known/oauth-authorization-server`
  (RFC 8414) with `issuer` and `jwks_uri`, so a region is configured with the
  issuer alone. A region can publish `/.well-known/oauth-protected-resource`
  (RFC 9728) naming the home, so the CLI and agents find where to sign in.
- **Step-up instead of fresh tokens.** For owner actions, a region answers
  `401` with `insufficient_user_authentication` and a `max_age` (RFC 9470),
  and the console signs the person in again at the home. The plan's "a token
  issued in the last 60 s" proved a recent token, not a recent person.
- **The cookie.** `__Host-Http-` instead of `__Host-`: it also guarantees
  `HttpOnly` (Chrome 140, Firefox 143; Safari and older browsers apply the
  `__Host-` rules), and RFC 10017 asks for it. `Path` is no boundary
  (RFC 6265bis). RFC 10017 also asks for `SameSite=Strict`, which would make
  a link from another site land signed out; the plan leaves that open.
- **The control plane.** RFC 8693 delegation with `act`, as planned. A region
  keeps a list of the actors it accepts, and decides on the person and the
  current actor only. Transaction tokens (an IETF draft, version 11) carry
  identity along a call chain inside one trust domain behind a gateway;
  identity chaining (approved, no RFC number yet) applies once a region runs
  an issuer of its own. Neither fits now.
- **Binding a token to a key** (DPoP, RFC 9449). RFC 9700 says SHOULD;
  RFC 10017 calls it hard for this pattern, and it does not stop script in
  the page. Server-to-server tokens first, later.

## 5. What Vercel adds

- A binding "does not authenticate or authorize the call", in Vercel's words.
  Vercel's OIDC token names a project and an environment, not a service, and
  every function of a project reads every secret. Inside one project, the
  control plane's credential, the home's database address and the master
  key are one file-read bug away from any function, so an `act` claim
  attributes a call and proves nothing.
- Separate projects (S1's fix: the home, each region, the control plane, the
  frontends) give each its own secrets and its own OIDC identity. The home
  can then accept the control plane's Vercel token as the actor credential of
  the exchange, checked by `project_id` and `environment` and never a
  development token, which any team member can pull. No shared secret is left
  to steal. The cost: no bindings between projects; their calls go over
  public HTTPS.
- **The tokens make that split cheap.** A region stops calling the home on
  every request. What remains between projects is fetching the keys, the
  directory read when a grant is written, the overage lookup and the pushed
  events, all rare.
- Vercel KMS (beta) signs tokens without the key in a variable, and Vercel
  Passport (Enterprise) is an identity-aware proxy. Neither is needed: the
  home's own signing keys (ADR 039) are the product's mechanism, and a
  self-hoster needs the same.

## 6. Residency

Only ids cross. The token carries ids, no names or emails. The shadow user
keeps the id and drops the attributes it copies today
([security S10](security.md)); names come from the home, as at Sentry and
Atlassian. Account data lives in Frankfurt, project data in its region, and a
region receives the ids of the people who act there. The ids stay personal
data for us, because we can tell whose they are (CJEU C-413/23 P, 2025), so
the residency promise names them. Most vendors keep the account directory
global and outside residency (Atlassian, Slack, Sentry, Linear).

## 7. What changes in the auth plan

1. The pattern is named, with the reason not to proxy (§1).
2. The request, the token and discovery follow RFC 8707, 9068 and 8414 (§4).
3. Teams: 50 in the token, an explicit overage, a lookup at the home (§2).
4. Removals are pushed, in phase 2 (§3).
5. Step-up per RFC 9470 replaces the fresh-token rule (§4).
6. The cookie gets `__Host-Http-` (§4).
7. The control plane's actor credential is its Vercel OIDC token once the
   projects are split; until then the actor is attribution only (§5).
8. Only ids in the regions (§6).

What stays: the cookie stays at the home; grants stay on the project in its
region; five minutes; the control plane exchanges tokens instead of
borrowing the cookie; the phases and their order.

## Sources

**Standards**

- RFC 10017, OAuth 2.0 for Browser-Based Applications (BCP 212), 2026:
  <https://www.rfc-editor.org/rfc/rfc10017>
- RFC 9068, JWT profile for access tokens, 2021; RFC 8707, resource
  indicators, 2020; RFC 8693, token exchange, 2020; RFC 8414, server
  metadata, 2018; RFC 9728, protected resource metadata, 2025; RFC 9470,
  step-up, 2023; RFC 9700, OAuth security BCP, 2025; RFC 9449, DPoP, 2023;
  RFC 8417, Security Event Tokens, 2018; RFC 8935, push delivery, 2020:
  <https://www.rfc-editor.org/>
- OpenID Shared Signals, CAEP and RISC final, 2025-09-02:
  <https://openid.net/three-shared-signals-final-specifications-approved/>
- Transaction tokens, draft 11, 2026-07-30:
  <https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/>;
  identity chaining, draft 17, 2026-07-19:
  <https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-chaining/>;
  `__Http-` and `__Host-Http-` cookies, 2026-05-21:
  <https://datatracker.ietf.org/doc/draft-ietf-httpbis-layered-cookies/>

**Products with one account and regional data**

- Sentry: <https://develop.sentry.dev/application-architecture/multi-region-deployment/cross-region-replication/>,
  <https://develop.sentry.dev/backend/application-domains/outboxes/>,
  <https://blog.sentry.io/designing-sentrys-cross-region-replication/> (2024-06-28),
  <https://docs.sentry.io/organization/data-storage-location/>
- Linear, "How we built multi-region support", 2024-05-23:
  <https://linear.app/now/how-we-built-multi-region-support-for-linear>
- GitLab, Cells design documents (ADR-014, 2025-01-13; organization login,
  2025-07-22): <https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/cells/>
- Shopify Engineering on Shopify Identity, 2019-12-26; Atlassian,
  <https://support.atlassian.com/security-and-access-policies/docs/understand-data-residency/>;
  Slack, <https://slack.com/help/articles/360035633934>; Grafana Cloud,
  Elastic Cloud and Zitadel Cloud documentation
- Netflix, edge authentication and identity propagation, 2021-02-09:
  <https://netflixtechblog.com/edge-authentication-and-token-agnostic-identity-propagation-514e47e0b602>

**Vendors' tokens**

- Clerk: <https://clerk.com/docs/guides/sessions/session-tokens>
- Entra: <https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference> (2026-07-24),
  <https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-continuous-access-evaluation> (2026-09-22)
- Okta: <https://support.okta.com/help/s/article/error-the-groups-claim-matched-too-many-groups-and-must-be-configured-to-match-fewer-groups> (2026-07-22)
- Auth0: <https://auth0.com/docs/manage-users/organizations/using-tokens>;
  WorkOS: <https://workos.com/docs/reference/authkit/session-tokens/access-token>;
  Supabase: <https://supabase.com/docs/guides/auth/signing-keys>
- Google IAP: <https://docs.cloud.google.com/iap/docs/signed-headers-howto>;
  Cloudflare Access: <https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/application-token/>
- Google Cloud IAM propagation: <https://docs.cloud.google.com/iam/docs/access-change-propagation> (2026-10-07)
- AWS Verified Permissions: <https://docs.aws.amazon.com/verifiedpermissions/latest/apireference/API_IsAuthorizedWithToken.html>;
  OpenFGA: <https://openfga.dev/docs/modeling/token-claims-contextual-tuples>
- Zanzibar, USENIX ATC 2019: <https://www.usenix.org/system/files/atc19-pang.pdf>

**Vercel**

- Bindings: <https://vercel.com/docs/services/bindings> (2026-07-15); OIDC
  claims: <https://vercel.com/docs/oidc/reference> (2026-09-17); environment
  variables: <https://vercel.com/docs/environment-variables>; header limits:
  <https://vercel.com/docs/errors/REQUEST_HEADER_TOO_LARGE>; middleware and
  services: <https://vercel.com/docs/build-output-api/services>; KMS:
  <https://vercel.com/docs/kms/concepts/project-grants>; Passport:
  <https://vercel.com/docs/passport/verify-identity>

**Residency**

- CJEU C-413/23 P, 2025-09-04:
  <https://curia.europa.eu/site/upload/docs/application/pdf/2025-09/cp250107en.pdf>;
  EDPB Guidelines 05/2021 on transfers, version 2.0, 2023-02-14
