# ADR 080: The Login Lives in the Customer's App and Becomes Its OIDC Provider

> **Status:** Proposed
> **Date:** 2026-10-24
> **Context:** How the scaffolded login becomes an OpenID Connect and OAuth 2
> provider on the customer's domain, and what that leaves of a login Zitadel
> renders.
> **Builds on:** [ADR 057](057-login-customization-categories.md), amended to
> drop Zitadel-served login
> ([#2307](https://github.com/zitadel/nextgen/pull/2307)).
> **Supersedes if accepted:** the platform overview's Zitadel-rendered login
> at Levels 3 and 4, and Level 2's authorization endpoints and issuer on a
> Zitadel subdomain.
> **Amends if accepted:** [ADR 077](077-api-path-prefix.md)'s reason that
> OIDC endpoints want the server's root, and the documents under
> [Documentation impact](#documentation-impact).
> **Related:** [ADR 024](024-user-team-lifecycle-ownership.md),
> [ADR 035](035-configuration-environments.md),
> [ADR 036](036-api-credential-planes.md),
> [ADR 037](037-token-lifecycle.md),
> [ADR 038](038-user-credential-migration-and-recovery.md),
> [ADR 039](039-signing-key-rotation-and-incident-response.md),
> [ADR 042](042-scaffolded-file-ownership-and-drift-detection.md),
> [ADR 044](044-scaffold-embedding-posture-defaults.md),
> [ADR 065](065-background-jobs.md),
> [ADR 068](068-project-is-the-data-boundary.md),
> [ADR 073](073-session-cookie-per-project.md),
> [ADR 074](074-preview-releases-on-0x.md),
> [ADR 076](076-error-pages-and-unmatched-routes.md)

## TL;DR

- The customer's app hosts the login at every integration level; Zitadel
  stays a backend API.
- Later, that login becomes the sign-in page of an authorization server whose
  issuer is the app's origin. Two `/.well-known/` paths reserved now let the
  server turn OIDC on without the app changing.
- Every response that leaves the app passes through the login page, and new
  work adds no credential, protocol or CSRF logic to generated code, so fixes
  ship as version bumps.

## Context

The platform overview makes Zitadel a backend API, yet has it render the
login at Levels 3 and 4 and serve `/authorize` at Level 2
([overview](../design/platform/overview.md#integration-levels)). The server
has no OIDC endpoint yet, and the widget never sends the `auth_request_id`
that `POST /flow` stores ([`flow.go`](../../internal/api/flow.go)). Apps keep
generated files and pinned packages for months, and Next.js reads its
generated `matcher` at build time
([`next/index.ts`](../../apps/cli/src/lib/orca/patchers/rule/next/index.ts)),
so what an authorization server needs from them has to ship first.

## Decision

### Part 1: the login is the customer's

### 1. The customer's app hosts the login

`zitadel setup` scaffolds the login into the customer's app, and no
integration level has Zitadel render a sign-in page for a customer's apps,
on its own host or on a custom domain. That leaves ADR 057's two
presentation models:

- **Embedded:** `<zitadel-login>` on pages setup writes and the customer
  owns (ADR 042, ADR 044).
- **Fully custom:** the customer's own UI on the flow API, which takes §8's
  and §9's steps itself to be a sign-in page for other apps.

The Console, Zitadel's own app, signs in the people who administer Zitadel's
resources, with the same widget on the server's origin, into the platform
project
([Console ADR 0004](../../apps/console/docs/adrs/0004-console-deployment-modes.md)
§1). A self-hosted server started by hand without
`platform.bootstrap_project` signs them in to a customer project instead, a
fallback Console ADR 0004 retires.

### 2. What a Zitadel-rendered login was for

ADR 057 had Zitadel-served login for SSO, third-party or legacy apps and a
centrally operated login
([as it stood](https://github.com/zitadel/nextgen/blob/ea054e637/docs/design/branding/customization-strategy.md#zitadel-served)),
and Level 3 adds a branded `auth.acme.com` and a redirect-style login. Part 2
does all of these: the scaffolded login app is the OIDC provider on the
customer's domain, other apps sign in with it as relying parties (§12) or as
any OIDC client, and `auth.acme.com` is such an app on that host. `zitadel
setup` makes one in a command.

### 3. What changes in the platform overview

- Levels 3 and 4: their hostnames host the customer's login app. Level 4's
  hostname-to-tenant mapping stays deferred.
- Level 2's authorization endpoints and issuer on a Zitadel subdomain are
  withdrawn. An SPA's issuer is its own origin (§5) once its production host
  forwards `/__nextgen` and the reserved paths (§7) and it can sign users in
  there, which waits for ADR 036's publishable key and the public-plane
  exchange ([#560](https://github.com/zitadel/nextgen/issues/560)); until
  then, a login app that has to be an issuer uses a server runtime. An SPA
  whose host cannot forward has no issuer.

### 4. Where a link into the login points

Magic links and email codes (ADR 038), background-job messages (ADR 065) and
invitations (ADR 024) will link to the customer's login. During a browser
request, a link opens the login path the SDK sent (§7) on the request's
origin: the recorded issuer (§5), or else the flow's. Outside one, it opens
the project's link target, one literal primary origin and a login path, set
on the project, not in a release, since these senders resolve no deployment.
The target defaults to the only literal primary pattern and `/login`; a
project with several or none sets it, and until then such a message fails
with an error naming the setting.

### Part 2: the scaffolded login becomes the OIDC provider

### 5. The issuer is the app's origin

The issuer is the origin an authorization request reached the app on, as the
server derives it from the forwarded headers. The request records it, and
its code and tokens carry it as `iss` wherever the token request arrives
(OpenID Connect Core §3.1.3.7).

Only a loopback origin while developing, or an origin a primary pattern of
the project names, can be an issuer. A project without patterns admits every
origin (ADR 036, 2026-10-08 amendment) but has no other issuer, and the
server's own origin and preview URLs (§10) never are one. A forged
`X-Forwarded-Host` must not mint an issuer, and shared caches never store
origin-dependent answers.

Each project signs with its own keys (ADR 039), published only under its
namespace (§6), so projects that share an origin cannot mint tokens for each
other's clients. Passkeys bind to the issuer's hostname, so the apps behind
one login app share a relying-party ID.

### 6. One namespace on the server

A project's authorization server lives under `/oauth/{project_id}/` on the
server, outside the resource API; the cloud's catch-all already receives it
(ADR 076). Two paths under it are fixed now:
`.well-known/openid-configuration`
([OpenID Connect Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html))
and `.well-known/oauth-authorization-server`
([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)). The server names the
other endpoints when it builds them, and the metadata lists them under the
app's proxy path (`/__nextgen/oauth/{project_id}/…`), since a static rewrite
can put the project in a path but cannot add a header. Like provider
sign-in's callback, this assumes the default `/__nextgen` prefix.

### 7. What the scaffold reserves

From the reservation release on
([Recommended sequence](#recommended-sequence)), every request boundary
forwards `/.well-known/openid-configuration` and
`/.well-known/oauth-authorization-server` to its project's §6 documents,
while the server still answers `404 req.not_found` (ADR 076): a client learns
there is no authorization server at that origin. Without a project id, the
SDK answers the 404 itself.

| Boundary | Change |
|---|---|
| Next.js | Generated `matcher` entries; the SDK maps the paths. |
| Nuxt, SvelteKit, SolidStart, TanStack Start, Qwik Router | The SDK alone. |
| SPA dev proxies (Vite, Angular) | Two generated entries, with the project from `ZITADEL_PROJECT_ID`, read as the cookie hooks read it (ADR 073). |
| SPA production hop | The hop `setup` will write ([#560](https://github.com/zitadel/nextgen/issues/560)), with the project id in its destination. |

The SDK proxy sends its `loginPath` (default `/login`) as
`X-Zitadel-Login-Path` on every request it forwards, replacing any incoming
value; without the header, the server uses `/login`. The value must be a
path, so it can only name a page on the issuer.

An app that serves the documents itself takes them out of its boundary. An
older app gets the SDK's part in a version bump and the generated entries
from `doctor --fix`, which `doctor` warns about. Nothing else is reserved.

### 8. How an authorization request reaches the login page

1. The authorization endpoint validates the client and its redirect URI; if
   either fails, it answers the error page (ADR 076) and redirects nowhere.
2. It stores the request (`auth_requests` in the
   [auth flows design](../design/api/authn-and-auth-flows.md#oidc-compatibility))
   and redirects (`303`) to the issuer's login path with an opaque handle:
   `/login?auth_request=<handle>`.
3. The handle is not a capability: a cookie set with the redirect binds it to
   the browser, as `_zsso` binds a provider callback, and `POST /flow`
   accepts it only with that binding. A second request in the same browser
   must not end the first: bindings are per request, the flow cookie (one
   `_zflow` per host today) gets one name per flow before the authorization
   server ships, and the proxies pass both through unchanged.
4. `<zitadel-login>` reads `auth_request` from the page URL and sends it as
   `auth_request_id` on `POST /flow`, also when it restarts a flow; a
   provider round trip returns to the same URL. Generated page code never
   sees it.
5. `login_hint` pre-fills the identifier and maps onto `hint.login_name`,
   whose "auto-submits" description goes: a URL anyone can craft never starts
   an identifier lookup or a message by itself (ADR 078). `prompt=create`
   starts at registration, whatever the page's `purpose`; `prompt=login`, or
   a last authentication older than `max_age`, forces a fresh one;
   `acr_values` stay for step-up.

Every response that leaves the app goes through the login page. Without
interaction (a live session, `prompt=none`, or a failure after the redirect
URI was validated), `POST /flow` answers a terminal step at once, seeing the
session in the cookie the proxy forwards (ADR 073). End session returns the
same way with its own handle before the widget sends the browser to
`post_logout_redirect_uri`; that handle and its confirmation are decided with
the endpoint. So the SDK proxy never passes a `Location` that leaves the app.

### 9. Completion

- A flow that carries an authorization request ends in a `redirect`,
  whatever its terminal step says, to a `redirect_uri` the server computes:
  the registered redirect URI with `code`, `state` and `iss`
  ([RFC 9207](https://www.rfc-editor.org/rfc/rfc9207)), or an `error`.
  `POST /flow` refuses an `auth_request_id` with a `redirect_uri`.
- The widget exchanges that step's handoff (`POST /sessions/exchange`)
  before navigating, so the session lands on the issuer's origin (ADR 073)
  and signing in for another app signs the user in to the login app too. The
  code is bound to that session; a step without a handoff navigates at once.
- Flows without an authorization request are unchanged.

This amends the auth flows design's rule that the OIDC adapter consumes the
handoff, which would leave no session on the issuer, and no SSO.

### 10. Which deployment serves an authorization request

A request is served from the newest deployment to its `Origin` (ADR 068,
[#536](https://github.com/zitadel/nextgen/issues/536)), which a flow seals at
its first step. `/authorize` has no `Origin`, and a token request carries the
client's origin or none, so:

- The authorization endpoint resolves no deployment: clients and redirect
  URIs are data-plane resources
  ([configuration surface](../design/platform/configuration-surface.md#the-split-config-vs-resources)).
- The flow an `auth_request_id` opens must run on the recorded issuer's
  origin (§5), and seals its deployment there.
- The code and its grants carry that deployment for token, userinfo and
  refresh, which never resolve from an `Origin` or fall back to the project
  default target ([#1616](https://github.com/zitadel/nextgen/issues/1616)).
  A revoked release ends them, as it ends a sealed flow.
- A preview URL ([#1312](https://github.com/zitadel/nextgen/issues/1312))
  signs users in but is never an issuer, so OIDC changes are tested on
  loopback or a primary origin kept for staging.
- In relying-party mode (§12) the login app's flow decides, even when the two
  apps pin different releases
  ([#1635](https://github.com/zitadel/nextgen/issues/1635)): a relying
  party's `X-Zitadel-Release` does not apply to the protocol endpoints.

### 11. Consent and account choice are flow steps

The engine inserts both; page code and flow definitions cannot add, drop or
reorder them, so a flow edit cannot remove a third-party client's consent
screen. Account choice comes first, on `prompt=select_account`; signing in
as someone else replaces the session at the exchange. Consent comes last,
when the client requires it for scopes not yet granted or the request says
`prompt=consent`. Consents are kept per user, client and scope. A client the
customer registers for its own apps, a relying-party-mode app for example,
is first-party and needs no consent unless the request asks for it. The
widget renders both from the step payload, with the client's name, logo and
scopes in a widget release; a request that needs a step the calling widget
predates (§13) fails with an error to the client.

### 12. Relying-party mode

`zitadel setup` gets a mode, working name `--sign-in-with <issuer>`, for an
app with a server runtime that signs in with another app. It gets the
request boundary and server SDK, configured with the issuer and a client id,
instead of a login page.

- The SDK sends protected routes to the issuer's authorization endpoint from
  its metadata, with PKCE, `state` and `nonce`, and answers the callback and
  sign-out under `/__nextgen`, reserving no root path.
- The CLI registers the app as a first-party client of the issuer's project,
  with redirect URIs on its origins, so its users are that project's.
  Signing in with another project is an IdP connection, out of scope.
- The app is a confidential client with its own credential, never the
  project secret; the client resource decides its kind (open question 3).
- The SDK signs the user in from the ID token, validated as OpenID Connect
  Core §3.1.3.7 requires (its signature against the issuer's JWKS, `iss`, an
  `aud` that names the client, `nonce`), and keeps the session in an HttpOnly
  cookie on the app's origin, so no token becomes script-readable. An access
  token is for the resources it names; where the app accepts one as a
  bearer, ADR 036's rule applies.

SPAs, with no server for the callback or the cookie, are not covered yet
(open question 9).

### 13. What generated code never owns

Generated code owns route files, the page around the widget (ADR 042),
configuration values and the path list a framework reads statically. New
work never gives it:

- **credentials:** the project secret, client credentials, and session,
  handoff and OAuth tokens. The SDK reads secrets from the environment and
  attaches them only where ADR 036 allows;
- **protocol handling:** endpoints, metadata, redirect-URI validation, PKCE,
  `state` and `nonce`, the code exchange, token validation and logout;
- **CSRF and cookie policy:** `X-Zitadel-CSRF`, origin checks, cookie
  attributes and ADR 073's cookie names;
- **flow logic:** steps, consent and account choice, §8's handle and §9's
  completion rule.

Two places predate the rule. The generated SPA dev proxies attach the project
secret, which ADR 036's publishable key retires, and carry ADR 073's cookie
hooks, which ADR 073 expects to move into a helper with it; the generated
SvelteKit hook hands the secret to its SDK. This ADR adds only path entries
to generated files.

So fixes ship as package releases and reach apps as version bumps, with
`doctor --fix` migrating a generated file it recognizes. Pins stay exact
(ADR 074 §4); a fix reaches pinned apps through `doctor`'s
[`dependency-version`](../../apps/cli/src/commands/doctor/checks/dependency-version.ts)
check, security advisories, and the server. The SDK proxy and the widget
name their package and version on every request (`X-Zitadel-Client`); the
server records them on the request's event and answers a version below a
published security floor with a warning header, which the SDK logs as an
error and `doctor` reports, without refusing the client.

### 14. What the server can turn on alone

For an app on the reservation release or later, the server can authorize
clients at the app's origin without the app changing; an SPA needs #560
first (§3). What builds on that arrives in package releases, never in a
re-scaffold: consent, account choice and end session (§8, §11),
relying-party mode (§12), and the SDK accepting the authorization server's
access tokens as bearers, which its verifier cannot yet: it expects `iss` to
be `ZITADEL_URL` and fetches keys from `{ZITADEL_URL}/auth/keys`
([`jwt.ts`](../../packages/sdk-core/src/jwt.ts)).

### 15. ADR 077 loses one reason

ADR 077 moves the resource API under `/api/v1/` partly to give protocol
endpoints the server's root. For OIDC that no longer holds: the metadata sits
at the app's root, and the server needs only `/oauth/`. If both ADRs are
accepted, ADR 077's §2 lists `/oauth/` where it lists
`/.well-known/openid-configuration`, and a cloud that routes the server by
prefix routes `/oauth/` beside `/api/`.

## Recommended sequence

1. This ADR and the documents below.
2. The reservation release, before the server's OIDC: the SDK's mapping and
   `X-Zitadel-Login-Path`, the `matcher` and dev proxy entries and their
   `doctor` migration, the widget's handle and completion rule, and
   `X-Zitadel-Client`.
3. The authorization server: stored requests, a flow cookie per flow,
   per-project signing keys, the authorization code flow with PKCE and `iss`,
   codes and grants that carry their deployment, metadata, JWKS, token and
   userinfo.
4. The self-host path: a login-only setup mode, Nuxt first, and a compose
   example that runs that app on its own hostname beside the server
   ([compose quick start](../quick-start/docker-compose.md)).
5. Consent, account choice and end session, with their widget release.
6. Relying-party mode.

The link target (§4) ships with the first message that links to the login
from outside a browser request.

## Consequences

### Positive

- ADR 057's two presentation models hold at every integration level.
- No app is scaffolded again for OIDC (§14), and an app gives up only two
  root paths, under the `/.well-known/` prefix
  [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615) reserves.
- Relying parties, and MCP clients once a resource names the issuer, find the
  authorization server at the app's origin, and the apps behind one login app
  share a passkey relying-party ID.

### Negative / Risks

- `/__nextgen` becomes part of public endpoint URLs, so renaming it breaks
  clients that copied them.
- Moving the login app to another domain changes the issuer, which relying
  parties pin, and the passkeys' relying-party ID;
  [ADR 038](038-user-credential-migration-and-recovery.md)'s related origins
  help with the latter.
- The login app becomes availability-critical for every relying party, with
  no Zitadel login to fall back on. The Console does not depend on it (§1),
  but under §1's fallback, restricting the customer project's origins to the
  app's locks operators out of the Console after the first step
  ([#2297](https://github.com/zitadel/nextgen/pull/2297)).
- The authorization response passes through the login page's scripts, as
  credentials do; PKCE and client authentication make a code read there
  useless, and a login-only app with a strict content security policy limits
  those scripts.
- Silent SSO costs one load of the login page (§8). `prompt=none` in an
  iframe works only for clients on the issuer's site, since a cross-site
  frame gets neither the session nor the flow cookie; others use refresh
  tokens.
- An app under a base path, or on a host it shares, cannot be an issuer: the
  metadata has to sit at the host's root.
- A customer who wanted Zitadel to host the login runs one more deployment
  (step 4 helps self-hosters).
- Apps pinned before the reservation release need a version bump, and
  Next.js apps a `doctor --fix`, before they can be an issuer.
- [#678](https://github.com/zitadel/nextgen/issues/678) still plans
  Zitadel-served login and [#1034](https://github.com/zitadel/nextgen/pull/1034)
  describes it; dropping it here and in #2307 needs product sign-off on both.

## Open questions

1. Is `/__nextgen` the public name, or does it change before OIDC ships?
2. The relying-party flag's name, and how the CLI finds the issuer's project.
3. A relying party's credential kind (client secret or `private_key_jwt`),
   and where its SDK keeps the session: an encrypted cookie needs a key in
   the layer ADR 036 empties of secrets.
4. Whether `POST /flow`'s free-form `redirect_uri` goes once authorization
   requests exist; they already carry the allowlist its TODO asks for.
5. Whether the server refuses clients below the security floor after GA.
6. Whether the SDK serves [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)
   protected-resource metadata for an app that hosts an MCP server. It names
   the app's own resource, so it belongs to a resource-server feature, not to
   this reservation.
7. Whether an SPA needs ADR 036's minimal worker on platforms that do not
   forward the original host.
8. Whether account choice also shows, by a project setting, whenever a live
   session exists.
9. An SPA as a relying party: a public client that holds its tokens in the
   browser, under the OAuth guidance for browser-based apps, or a backend
   that holds them for it.
10. Whether a refresh keeps the deployment sealed at sign-in until the grant
    ends, as §10 has it, or moves to the newest deployment to the issuer's
    origin, which would carry a configuration fix to long-lived grants.
11. Can the passkey relying-party ID be the registrable domain rather than
    the full hostname (`passkeyRPFromOrigin`), so moving the login between
    subdomains keeps passkeys? ADR 038's related origins are the other lever.

## Rejected alternatives

- **Zitadel renders the login on a custom domain** (Level 3's model): a
  second owner of the sign-in page, when a login app on that host does the
  same jobs (§2).
- **A prebuilt SPA login for self-hosters and homelabs:** it needs OIDC, as a
  static bundle the publishable key (#560), and a hostname of its own, since
  on the server's origin it cannot sign anyone in
  ([#2297](https://github.com/zitadel/nextgen/pull/2297)); and it would run
  the last deployment to its origin (#536). Then it is this ADR's login app,
  prebuilt, and a second owner of the sign-in page that customers fork, as
  with Zitadel v4's Login V2. Homelabs have Zitadel v4; self-hosters get
  step 4 of the [Recommended sequence](#recommended-sequence).
- **Scaffold the OIDC routes on demand** (the configuration surface's plan):
  a re-scaffold by another name.
- **Endpoints at the app's root:** each is a common route name that would
  need a `matcher` entry.
- **Create the flow at `/authorize` and redirect with `?flow=`:** the flow
  loses the page's `purpose` and definition, flow creation becomes a
  cross-site `GET`, and a restart drops the request.
- **Generated page code reads the handle:** the same lines in every
  template, and a page that forgets them drops the request.
- **Let the proxy pass redirects that leave the app:** every app on that SDK
  would accept answers that send its browser anywhere.
- **A server-rendered page that redirects:** a page Zitadel renders on the
  customer's origin, which §1 rules out.
- **Serve the widget from the server:** each server deploy would change it
  under every app, so pins would mean nothing.
- **The issuer on Zitadel's host,** such as `zitadel.cloud/p/<project>`:
  tokens and passkeys tied to Zitadel's domain break when the customer
  leaves the cloud.

## Non-goals

- The `/ui/login/` removal and ADR 057's amendment
  ([#2307](https://github.com/zitadel/nextgen/pull/2307)).
- SAML and SCIM.
- Token formats, claims and lifetimes (ADR 037), the ID token included, and
  the client resource's API.
- What else MCP clients need: protected-resource metadata
  ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)), client registration
  and resource indicators ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)).
- Logout propagation to relying parties.
- Level 2's cookie subdomain and Level 4's hostname mapping.

## Documentation impact

This change corrects the overview's pointer to ADR 057's presentation models.
On acceptance:

- the platform [overview](../design/platform/overview.md) and
  [README](../design/platform/README.md): Level 1's "scaffolded later"
  paragraph, Level 2's endpoints and issuer, and Levels 3 and 4;
- [`configuration-surface.md`](../design/platform/configuration-surface.md):
  §6 and §7 replace "Proxy endpoints (scaffolded on demand)", and §5 and §4
  what it says about `iss` and magic-link hostnames;
- [`resource-map.md`](../design/api/resource-map.md#hosted-protocol-surfaces)'s
  hosted protocol surfaces, and
  [`authn-and-auth-flows.md`](../design/api/authn-and-auth-flows.md)'s OIDC
  compatibility lock and Path 3;
- the [glossary](../design/glossary.md)'s *custom domain* and *project* rows
  and integration levels;
- ADR 077's README summary, if both ADRs are accepted.

On implementation: the CLI's
[`SKILL.md`](../../apps/cli/skills/zitadel-cli/SKILL.md), the SDK and
components READMEs, the API spec's `hint.login_name` description, and the
[compose quick start](../quick-start/docker-compose.md).
