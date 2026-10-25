# ADR 079: The Login Lives in the Customer's App and Becomes Its OIDC Provider

> **Status:** Proposed
> **Date:** 2026-10-24
> **Context:** How a login the customer's app hosts becomes the sign-in page
> of an OpenID Connect and OAuth 2 authorization server on the customer's
> domain without being scaffolded again, and what that leaves of a login
> Zitadel renders.
> **Builds on:** [ADR 057](057-login-customization-categories.md), amended to
> drop Zitadel-served login (the `/ui/login/` removal,
> [#2307](https://github.com/zitadel/nextgen/pull/2307)).
> **Supersedes if accepted:** the platform overview's Zitadel-rendered login
> at Levels 3 and 4, and Level 2's authorization endpoints and issuer on a
> Zitadel subdomain.
> **Amends if accepted:** [ADR 077](077-api-path-prefix.md)'s reason that the
> planned OIDC endpoints want the server's root, and the design documents
> under [Documentation impact](#documentation-impact).
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

- The login UI is always hosted by the customer's app: `zitadel setup`
  scaffolds it, and Zitadel stays a backend API. ADR 057's amendment makes
  that the rule for presentation; this ADR makes it the rule for the
  platform's integration levels too.
- A link sent outside a browser request, such as an invitation, opens the
  project's link target: one literal primary origin and its login path.
- Later, that login becomes the sign-in page of an authorization server whose
  issuer is the app's origin, with Zitadel behind the `/__nextgen` proxy.
- The scaffold reserves two root paths now,
  `/.well-known/openid-configuration` and
  `/.well-known/oauth-authorization-server`, and forwards them while the
  server answers 404. The endpoints live under `/__nextgen`, so the server
  can start authorizing clients at an app's origin without the app changing.
- An authorization request reaches the login page as an opaque handle, which
  the widget reads and sends as `auth_request_id`. A flow that carries one
  ends in a redirect the widget performs after it exchanges the handoff, and
  every response that leaves the app goes through the login page.
- That flow runs on the issuer's origin and picks the deployment, which the
  code and the grants carry. A preview URL is never an issuer.
- Consent and account choice are steps the engine inserts. A relying-party
  mode scaffolds an app that signs in with another app.
- New work adds no credential, protocol or CSRF logic to generated code, so
  fixes reach apps as version bumps.

## Context

### What ships today

- `zitadel setup` writes `/login`, `/register` and `/profile` for every
  framework, and a request boundary that forwards `/__nextgen/*` to
  `ZITADEL_URL`. On Next.js the boundary is a generated file whose `matcher`
  lists `/__nextgen/:path*` and `/profile/:path*`
  ([`next/index.ts`](../../apps/cli/src/lib/orca/patchers/rule/next/index.ts)),
  and Next.js reads that list statically, at build time; its login page sets
  `postSignInUrl="/profile"`. The other five server SDKs (Nuxt, SvelteKit,
  SolidStart, TanStack Start, Qwik Router) see every request and match paths
  themselves. The SPA scaffolds write a dev proxy into the app's Vite or
  Angular config (ADR 073), which attaches the project secret to the handoff
  exchange; no scaffold writes a production hop for an SPA. No scaffold
  writes an OIDC route.
- The server has no OIDC or SAML endpoint. `POST /flow` accepts an
  `auth_request_id`, which the flow state stores and nothing reads, and a
  `redirect_uri` it does not validate
  ([`flow.go`](../../internal/api/flow.go), with a TODO for when OIDC lands).
  `terminate()`
  ([`flow_state_machine.go`](../../internal/domain/flow_state_machine.go))
  copies that `redirect_uri` onto the terminal step only when the step is
  `complete: "redirect"`. The default flow
  ([`default-login.json`](../../packages/config/defaults/default-login.json))
  ends in `complete: "show"`. A browser holds one flow cookie per host,
  `_zflow` (`SameSite=Strict`, `Path=/`).
- `<zitadel-login>` follows `redirect_uri` on `complete: "redirect"` without
  exchanging the handoff. On `show` with a `post-sign-in-url`, it exchanges
  the handoff and goes there (`maybeCompleteFlow` in
  [`zitadel-login.ts`](../../packages/components/src/orchestrator/zitadel-login.ts)).
  It reads `flow` and `next` from the page URL and never sends
  `auth_request_id`.
- The SDK proxy rebases every upstream `Location` onto the app, because
  nothing legitimate on that path points elsewhere (`filterResponseHeaders`
  in [`middleware.ts`](../../packages/sdk-core/src/middleware.ts)). The server
  derives a request's origin from `X-Forwarded-Proto` and `X-Forwarded-Host`
  (`WithRequestHostMiddleware`), which the proxies set when the browser's
  request does not, and binds passkeys to the hostname of the browser's
  origin (`passkeyRPFromOrigin`).
- Setup pins the `@zitadel/*` packages to the CLI's exact version (ADR 074
  §4), and `doctor`'s `dependency-version` check warns when the pins differ
  from the CLI's.

### Logins Zitadel renders, in the docs

The platform overview's invariant is that Zitadel is a backend API and the
customer's app serves every user-visible surface on its own origin. At Level
1 the app proxies `/authorize`, `/token` and `/userinfo` to Zitadel
([overview](../design/platform/overview.md#integration-levels)). ADR 057 put
a second model beside it: Zitadel-served login at `/ui/login/`, which arrived
as a side effect of packaging the server with its UIs
([#165](https://github.com/zitadel/nextgen/pull/165)), was adopted as that
model ([#678](https://github.com/zitadel/nextgen/issues/678)), and never
created a session. The model was named after that placeholder, which
defaulted to a project called `demo`, rather than decided. The `/ui/login/`
removal ([#2307](https://github.com/zitadel/nextgen/pull/2307)) takes it out
and amends ADR 057 to drop it.

Three places in the platform design still have Zitadel host the login or its
protocol endpoints. Level 3 renders the login on a custom domain, Level 4
builds on Level 3, and Level 2 serves `/authorize` from a Zitadel subdomain,
which becomes the tokens' `iss`.

The goal is a ready-made scaffolded login that can become an OIDC and OAuth
server later. Two documents stand in the way of "later, without a
re-scaffold". The
[configuration surface](../design/platform/configuration-surface.md#proxy-endpoints-scaffolded-on-demand)
scaffolds the OIDC proxy routes on demand, when `zitadel push` sees an IdP or
an OIDC client. ADR 077 moves the resource API under `/api/v1/` partly so the
planned protocol endpoints can take the server's root.

### Why now

An app keeps its generated files and its pinned packages for months.
Whatever the authorization server needs from them has to ship before the
server's OIDC does, or every app needs an edit when it lands. Next.js makes
this concrete: a path missing from the generated `matcher` never reaches the
SDK.

## Decision

### Part 1: the login is the customer's

### 1. The customer's app hosts the login, always

`zitadel setup` scaffolds the login into the customer's app, and Zitadel stays
a backend API. No integration level has Zitadel render a sign-in page for a
customer's apps, on its own host or on a custom domain. The two presentation
models ADR 057 keeps after its amendment are the whole list:

- **Embedded:** the app renders `<zitadel-login>` on pages setup writes and
  the customer then owns (ADR 042, ADR 044).
- **Fully custom:** the customer's own UI on the flow API. To be a sign-in
  page for other apps, it takes §8's and §9's steps itself.

The Console is Zitadel's app for operating Zitadel. It signs in with the same
embedded widget, on a page of its own under `/ui/console/` on the server's
origin ([`login.tsx`](../../apps/console/src/routes/login.tsx)), configured by
the server's runtime document
([`console_runtime.go`](../../cmd/server/console_runtime.go)). That sign-in
belongs to the Console. No app of the customer's sends its users there.

The project the Console signs in to is partly transitional. A server with
`platform.bootstrap_project`, which `zitadel start` and the cloud turn on,
signs it in to the reserved platform project of
[Console ADR 0004](../../apps/console/docs/adrs/0004-console-deployment-modes.md)
§1, which no customer's application signs its users in to. A server without
it signs the Console in to the pinned `platform.project_id` or to the
first-created project, normally the one `zitadel setup` creates for the
customer. The pin and that fallback retire with Console ADR 0004.

### 2. What a Zitadel-rendered login was for

Before the amendment, ADR 057's long form gave Zitadel-served login three
jobs: SSO, third-party or legacy apps, and a centrally operated login
([as it stood](https://github.com/zitadel/nextgen/blob/ea054e637/docs/design/branding/customization-strategy.md#zitadel-served)).
Level 3 adds a branded `auth.acme.com` and a redirect-style login. Part 2
does all of these without Zitadel hosting a page. A scaffolded login app is
the OIDC provider on the customer's domain, and other apps sign in with it,
as relying parties (§12) or as any OIDC client. A branded `auth.acme.com` is
such a login app deployed on that host.

A vendor-hosted login made sense while building one was expensive. `zitadel
setup` now scaffolds a working login in one command, and agents customize it.

### 3. What changes in the platform overview

- Levels 3 and 4 stop having Zitadel render the login: their branded and
  per-customer hostnames are hosts of the customer's login app. Level 4's
  hostname-to-tenant mapping stays deferred.
- Level 2's authorization endpoints and issuer on a Zitadel subdomain are
  withdrawn. An SPA's issuer is its own origin, like any app's (§5), once its
  production host forwards `/__nextgen` and the reserved paths (§7) and it
  can sign users in there. It cannot yet: only the generated dev proxies
  attach the project secret to the handoff exchange, which §9 needs before
  the widget navigates. Production sign-in on a static host, and with it an
  SPA issuer, waits for ADR 036's publishable key and the public-plane
  exchange ([#560](https://github.com/zitadel/nextgen/issues/560)). Until
  then a login app that has to be an issuer uses a framework with a server
  runtime. An SPA whose host cannot forward has no issuer. Whether Level 2's
  cookie subdomain survives for such hosts is outside this ADR.

### 4. Where a link into the login points

Messages that link to the login are planned: magic links and email codes for
sign-in and recovery (ADR 038), messages that background jobs send later
(ADR 065), and invitations (ADR 024). None ships yet: `magic_link` can be
enabled in the meta-schema, but the flow engine does not handle it. With no
page of Zitadel's own, every such link opens the customer's login.

- **During a browser request,** the link opens the login path the SDK sent
  (§7) on the request's origin: the recorded issuer for an authorization
  request (§5), the flow's origin otherwise.
- **Outside one,** an invitation sent from the Console or the API, or a
  message a background job sends, has neither, and a project can have
  several primary origins or only wildcards. Such a link opens the project's
  link target: one literal primary origin and a login path. It defaults to
  the project's only literal primary pattern and `/login`. A project with
  several literal patterns, or none, sets it, and until it does such a
  message fails with an error that names the setting.

The link target is a setting on the project beside its origin patterns, not
part of a release, because the senders that need it resolve no deployment.

### Part 2: the scaffolded login becomes the OIDC provider

### 5. The issuer is the app's origin

The issuer is the origin an authorization request reached the app on, as the
server derives it from the forwarded headers. The request records it, and
the code and every token it yields carry it as `iss`, whichever origin the
token request arrives on: a client checks for the exact issuer it discovered
(OpenID Connect Core §3.1.3.7).

The server acts as issuer only for an origin one of the project's primary
patterns names, or for a loopback origin while developing. A project without
patterns admits every origin (ADR 036, 2026-10-08 amendment), but that
allowance does not make every origin an issuer, and the server's own origin
never is one. Nor is a preview URL (§10). The proxies pass a browser's
`X-Forwarded-Host` through, and the server can be called directly, so a
forged header must not mint an issuer. Answers that depend on the origin are
never stored by shared caches.

Origins are not unique across projects, so `iss` alone does not tell
projects apart. Each project signs with keys of its own (ADR 039), published
only under its own namespace (§6), so two projects that claim one origin
cannot mint tokens for each other's clients.

Passkeys are bound to the issuer's hostname, so the customer's apps that sign
in through one login app share one relying-party ID.

### 6. One namespace on the server

The authorization server of a project lives under `/oauth/{project_id}/` on
the server, outside the resource API. On the cloud, the server's catch-all
already receives it (ADR 076). Two of its paths are fixed now, because the
request boundaries map onto them before the server serves them:

- `/oauth/{project_id}/.well-known/openid-configuration`
  ([OpenID Connect Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html))
- `/oauth/{project_id}/.well-known/oauth-authorization-server`
  ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414))

MCP clients read either document once a resource's protected-resource
metadata names the issuer; what else they need is under
[Non-goals](#non-goals).

The server names every other endpoint (authorization, token, userinfo, JWKS,
revocation, introspection, end session, registration) when it builds it. The
metadata lists them as URLs under the app's proxy path, for example
`https://acme.com/__nextgen/oauth/{project_id}/authorize`. The project is in
the path because one server serves many projects, and a static rewrite can
name it in its destination but cannot add a header. Provider sign-in already
assumes the default `/__nextgen` prefix for its callback; the authorization
server does the same.

### 7. What the scaffold reserves

The app gives up two root paths beyond the `/__nextgen` prefix it already
hands the SDK: `/.well-known/openid-configuration` and
`/.well-known/oauth-authorization-server`. From the reservation release on
(see [Recommended sequence](#recommended-sequence)), every request boundary
forwards them to the §6 documents of the app's project, while the server
still answers `404 req.not_found` (ADR 076): a client learns that there is no
authorization server at that origin. Without a project id, the SDK answers
the 404 itself.

| Boundary | Change |
|---|---|
| Next.js | The generated `matcher` lists both paths; the SDK maps them. |
| Nuxt, SvelteKit, SolidStart, TanStack Start, Qwik Router | The SDK alone. |
| SPA dev proxies (Vite, Angular) | Two entries in the generated proxy, with the project from `ZITADEL_PROJECT_ID`, read the way its cookie hooks read it (ADR 073). |
| SPA production hop | The hop `setup` will write ([#560](https://github.com/zitadel/nextgen/issues/560): a `vercel.json` rewrite, a `netlify.toml` redirect or a worker) lists both paths, with the project id in the destination. |

The SDK proxy also tells the server where the app's login page is. It sends
its `loginPath` (default `/login`, which every scaffold writes) as
`X-Zitadel-Login-Path` on every request it forwards, replacing any incoming
value. Without the header, behind a static rewrite for example, the server
uses `/login`. The value must be a path, so it can only name a page on the
issuer.

An app that serves these documents itself takes them out of its boundary
(the `matcher`, or `ignoredRoutes`). An app scaffolded before the
reservation gets the SDK's part with a version bump. The generated part, the
Next.js `matcher` entries and the dev proxy entries, comes from
`doctor --fix`, which adds them to a file it recognizes, as it adds ADR 073's
cookie hooks; until then `doctor` warns, since sign-in works without them. No
other route is reserved: the server can add, rename or retire endpoints
without touching an app.

### 8. How an authorization request reaches the login page

1. The authorization endpoint validates the client and its redirect URI. If
   either fails, it answers the error page (ADR 076) and redirects nowhere.
2. It stores the request (the `auth_requests` of the
   [auth flows design](../design/api/authn-and-auth-flows.md#oidc-compatibility))
   and redirects (`303`) to the login path on the issuer with an opaque
   handle: `/login?auth_request=<handle>`. The redirect stays on the app's
   origin, so the proxy's `Location` rule holds.
3. The handle is not a capability. The same response binds it to the browser
   with a cookie, as `_zsso` binds a provider callback, and `POST /flow`
   accepts an `auth_request_id` only with that binding. A second request in
   the same browser must not end the first: the binding is kept per request,
   and the flow cookie, one `_zflow` per host today (ADR 073, "Not covered"),
   gets one name per flow before the authorization server ships. The proxies
   pass such cookies through unchanged.
4. `<zitadel-login>` reads `auth_request` from the page URL, as it reads
   `flow`, and sends it as `auth_request_id` on `POST /flow`. Generated page
   code never sees it. The widget sends it again when it restarts a flow, and
   a provider round trip returns to the same URL.
5. The request shapes the flow.
   - `login_hint` pre-fills the identifier and never submits it: a URL anyone
     can craft must not start an identifier lookup or a message by itself
     (ADR 078). It maps onto the contract's `hint.login_name`, whose
     "auto-submits" description goes; the server does not act on that field
     today.
   - `prompt=create` starts at registration, whatever the page's `purpose`.
   - `prompt=login`, or a last authentication longer ago than `max_age`,
     requires a fresh authentication even with a live session.
   - `acr_values` stay on the request for the step-up check.

Every response that leaves the app goes through the login page. A request
that needs no interaction still lands there: a live session satisfies it, it
says `prompt=none`, or it failed after its redirect URI was validated.
`POST /flow` then answers a terminal step at once; it sees the session
because the proxy forwards the app's session cookie on every call (ADR 073).

End session takes the same path. OpenID Connect RP-Initiated Logout sends the
browser on to the client's `post_logout_redirect_uri`, so the end-session
endpoint redirects to the login path with a handle of its own, and the
widget performs that navigation too. That handle, and the confirmation the
specification recommends, are decided with the endpoint. The widget performs
every cross-origin navigation, so the SDK proxy never has to pass a
`Location` that leaves the app.

### 9. Completion

- A flow that carries an authorization request ends in a `redirect`,
  whatever its definition's terminal step says. Its `redirect_uri` is the
  client's registered redirect URI with the authorization response, computed
  by the server and never taken from `POST /flow`: `code`, `state` and `iss`
  ([RFC 9207](https://www.rfc-editor.org/rfc/rfc9207), so a client that talks
  to several authorization servers can tell them apart), or an `error`.
- When the widget started the flow with an `auth_request_id`, it exchanges
  the terminal step's handoff (`POST /sessions/exchange`) before it
  navigates. The exchange puts the session on the issuer's origin, under the
  app's own cookie (ADR 073). Signing in for another app therefore signs the
  user in to the login app too, and the next authorization request finds the
  session. The code is bound to the session that handoff establishes. A
  terminal step without a handoff (a live session already satisfied the
  request, or the request failed) navigates at once.
- Without an authorization request nothing changes. `show` exchanges and goes
  to `post-sign-in-url` or the page's `next`, and a definition's `redirect`
  follows its URI without an exchange.
- `POST /flow` refuses an `auth_request_id` together with a `redirect_uri`.

This amends the auth flows design's locked rule that the OIDC adapter
consumes the handoff internally to mint the code. Consumed there, the handoff
would produce a code but no session on the issuer's origin, and without that
session there is no SSO.

### 10. Which deployment serves an authorization request

Under ADR 068 a deployment targets origins, and runtime resolution
([#536](https://github.com/zitadel/nextgen/issues/536)) serves a request from
the `Origin` it carries: the gate admits the origin, the target is the newest
deployment to it, and the release is that deployment's. A flow seals its
deployment at the first step. An authorization request does not carry what
that needs: `/authorize` is a top-level navigation with no `Origin`, and a
token request carries the client's origin or none.

- The authorization endpoint resolves no deployment. Clients and their
  redirect URIs are data-plane resources, not part of a release
  ([configuration surface](../design/platform/configuration-surface.md#the-split-config-vs-resources)),
  so it validates them and records the issuer without one.
- The flow an `auth_request_id` opens must run on the recorded issuer's
  origin (§5), and it resolves and seals its deployment there, as every flow
  does.
- The code and the grants it yields carry that deployment, and token,
  userinfo and refresh run on it. They never resolve from an `Origin` and
  never fall back to the project default target
  ([#1616](https://github.com/zitadel/nextgen/issues/1616)), so they keep
  working once the interim path that serves the newest revisions when nothing
  is deployed goes. A revoked release ends them as it ends a sealed flow, and
  the client starts a new authorization request.
- A live preview URL ([#1312](https://github.com/zitadel/nextgen/issues/1312))
  signs users in directly but is never an issuer: relying parties pin the
  issuer, and a preview expires with its TTL. OIDC changes are tested on
  loopback or on a primary origin kept for staging.
- In relying-party mode (§12), the login app and the relying party are builds
  of one project and can pin different releases
  ([#1635](https://github.com/zitadel/nextgen/issues/1635)). The login app's
  flow decides: a relying party's `X-Zitadel-Release` does not apply to the
  protocol endpoints.

### 11. Consent and account choice are flow steps

The engine inserts both. Neither page code nor a flow definition can add,
drop or reorder them, so a third-party client cannot lose its consent screen
to a flow edit.

- **Account choice** comes first, when the request says
  `prompt=select_account`: continue with the live session, or sign in as
  someone else, whose session the exchange then replaces.
- **Consent** comes last, before completion, when the client requires consent
  and the user has not granted it those scopes, or when the request says
  `prompt=consent`. A grant is stored per user, client and scope. A client the
  customer registers for its own apps, a relying-party-mode app for example,
  is first-party and needs no consent unless the request asks for it.

The widget renders both from the step payload. The client's name and logo
and the list of scopes are payload it does not render today, so they arrive
in a widget release. The server knows which widget version calls it (§13). A
request that needs a step the calling widget predates fails with an error to
the client, rather than show a step the widget cannot draw.

### 12. Relying-party mode

`zitadel setup` gets a mode for an app with a server runtime that signs in
with another app instead of getting its own login, for example
`docs.acme.com` signing in with `acme.com`. The flag is open;
`--sign-in-with <issuer>` is the working name.

- The app gets no `<zitadel-login>` page. It gets the same request boundary
  and server SDK, configured with the issuer and a client id instead of a
  login path.
- A protected route sends the browser to the issuer's authorization
  endpoint, found through its metadata. The SDK builds the request
  (authorization code with PKCE, `state` and `nonce`), and it answers the
  callback and sign-out itself under its `/__nextgen` prefix instead of
  forwarding them, so this mode reserves no root path either.
- The CLI registers the app as a first-party client of the issuer's project,
  with redirect URIs on the app's origins. The app's users are that project's
  users. Signing in with another project is an IdP connection and out of
  scope.
- The app is a confidential client with a credential of its own, never the
  project secret. ADR 036 leaves per-app client credentials open, and the
  client resource decides their kind.
- The SDK signs the user in from the ID token, validated as OpenID Connect
  Core §3.1.3.7 requires: its signature against the issuer's JWKS, `iss`, an
  `aud` that names the client, and `nonce`. An access token is for the
  resources it names; where the app accepts one as a bearer, ADR 036's rule
  applies. The SDK keeps the app's session in an HttpOnly cookie on the app's
  origin, and no token becomes script-readable.

An SPA has no server to answer the callback or set an HttpOnly cookie, so
this mode does not cover it yet (open question 9).

### 13. What generated code never owns

Generated code owns route files and the page around the widget (ADR 042's
presentation files), configuration values (the project id variable,
protected routes, the login path, the issuer and client id), and the path
list a framework reads statically, Next.js's `matcher`. New work never gives
it:

- **credentials:** the project secret, client credentials, and session,
  handoff and OAuth tokens. The SDK reads secrets from the environment and
  attaches them only where ADR 036 allows;
- **protocol handling:** authorization and token endpoints, metadata,
  redirect-URI validation, PKCE, `state` and `nonce`, the code exchange,
  token validation and logout;
- **CSRF and cookie policy:** `X-Zitadel-CSRF`, origin checks, cookie
  attributes and ADR 073's cookie names;
- **flow logic:** steps, consent and account choice, and §8's handle and §9's
  completion rule.

Two places predate the rule. The generated SPA dev proxies attach the project
secret to the handoff exchange and carry ADR 073's cookie hooks, and the
generated SvelteKit hook hands the secret to its SDK. ADR 036's publishable
key retires the first, and ADR 073 expects the hooks to move into a helper
with it. This ADR adds only path entries to generated files.

So every fix ships as a package release and reaches an app as a version
bump, never as a re-scaffold. Where a fix needs a generated file to change,
`doctor --fix` migrates a file it recognizes, as §7 does for the `matcher`.

Pins stay exact (ADR 074 §4). A fix reaches a pinned app three ways:

- `doctor`'s [`dependency-version`](../../apps/cli/src/commands/doctor/checks/dependency-version.ts)
  check, which already names the command that moves the pins to the CLI's
  version;
- a security advisory on the affected npm packages, which `npm audit`,
  Dependabot and Renovate read and act on for exact pins;
- the server. The SDK proxy and the widget name their package and version on
  every request (`X-Zitadel-Client`). The server records them on the
  request's event and answers a version below a published security floor
  with a warning header, which the SDK logs as an error and `doctor`
  reports. It does not refuse an old client.

### 14. What the server can turn on alone

For an app on the reservation release or later, the server can start
authorizing clients at the app's origin without the app changing: other apps
send their users to its login page and get codes and tokens back. An SPA
needs #560 first (§3). What builds on that arrives in package releases, never
in a re-scaffold:

- consent and account choice (§11), and end session (§8);
- relying-party mode (§12);
- the SDK accepting the authorization server's access tokens as bearers. Its
  verifier expects `iss` to be `ZITADEL_URL` and fetches keys from
  `{ZITADEL_URL}/auth/keys` ([`jwt.ts`](../../packages/sdk-core/src/jwt.ts)),
  not from the issuer's metadata.

### 15. ADR 077 loses one reason

ADR 077 moves the resource API under `/api/v1/` partly so the planned
protocol endpoints can take the server's root. For OIDC that no longer
holds: the metadata documents sit at the root of the app, not of the server,
and on the server the authorization server is one namespace, `/oauth/`. If
both ADRs are accepted, ADR 077's §2 lists `/oauth/` among the server's root
paths where it lists `/.well-known/openid-configuration`, and a cloud that
routes the server by prefix routes `/oauth/` beside `/api/`. ADR 077's other
reasons stand: a host shared with the website, the docs, the console and the
built-in schemas, and proxies that select the API by one prefix. SAML and
SCIM keep whatever their own decisions set.

## Recommended sequence

1. This ADR, with the documents below.
2. The reservation release: the `matcher` entries and their `doctor`
   migration, the SDK's mapping and `X-Zitadel-Login-Path`, the dev proxy
   entries, the widget's handle and completion rule, and `X-Zitadel-Client`.
   It ships before the server's OIDC.
3. The authorization server: stored requests, a flow cookie per flow,
   per-project signing keys, the authorization code flow with PKCE and
   `iss`, codes and grants that carry their deployment, metadata, JWKS, token
   and userinfo.
4. The self-host path: a `zitadel setup` mode that scaffolds only a login
   app, on Nuxt first because a server runtime can do the exchange before
   #560, and a compose example that runs that app on a hostname of its own
   beside Postgres and the server. The
   [compose quick start](../quick-start/docker-compose.md) runs only those two
   today.
5. Consent, account choice and end session, with their widget release.
6. Relying-party mode in setup and the server SDKs.

The link target (§4) ships with the first message that links to the login
from outside a browser request.

## Consequences

### Positive

- No integration level has Zitadel render a page, so ADR 057's two
  presentation models hold everywhere.
- For an app on the reservation release or later, the server starts
  authorizing clients at the app's origin without the app changing (§14). No
  app is ever scaffolded again for it.
- An app gives up two root paths, both under `/.well-known/`, the prefix
  [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615) sets aside for
  site-wide metadata.
- The proxy keeps its rule that a proxied `Location` lands on the app.
- OIDC relying parties find the authorization server at the app's origin,
  and so do MCP clients once a resource names it.
- The customer's apps that sign in through one login app share one passkey
  relying-party ID.

### Negative / Risks

- `/__nextgen` becomes part of public endpoint URLs once the server ships
  OIDC. Renaming it afterwards breaks clients that copied endpoint URLs
  instead of reading the metadata.
- The issuer is the login app's origin. Moving that app to another domain
  changes the issuer, which relying parties pin, and the passkeys'
  relying-party ID; [ADR 038](038-user-credential-migration-and-recovery.md)'s
  related origins help with the latter.
- The login app becomes availability-critical for every relying party.
  Zitadel has no login of its own to fall back on. That is the end users'
  sign-in: operators sign in through the Console's own page (§1), whether or
  not the login app is deployed. Where the Console still signs in to the
  customer's project, operators are users of that project and sign in
  through its flow, and every step must come from an origin that project
  admits. Once the customer restricts it to their app's origins, the Console
  on the server's origin can open a flow
  ([#2297](https://github.com/zitadel/nextgen/pull/2297)) but not finish one.
  Full independence from the customer's project waits for Console ADR 0004's
  platform project in every deployment.
- The authorization response passes through the login page's scripts, as
  the user's credentials already do. PKCE, and a confidential client's own
  authentication, keep a code read there useless to anyone but the client. A
  login-only app on a hostname of its own, with a strict content security
  policy, keeps the main app's third-party scripts away from both; that
  isolation is a deployment choice, not a reason for Zitadel to host the
  login.
- Silent SSO costs one load of the login page. `prompt=none` in an iframe
  works only for clients on the issuer's site: in a cross-site frame the
  browser sends neither the session cookie (`SameSite=Lax`) nor the flow
  cookie (`SameSite=Strict`), so other clients use refresh tokens.
- An app under a base path, or on a host it shares, cannot be an issuer: the
  metadata has to sit at the host's root.
- A customer who wanted Zitadel to host their login deploys an app instead.
  `zitadel setup` scaffolds a fresh one in one command, but it is one more
  deployment to run. For self-hosters, step 4 of the sequence brings a
  login-only setup and a compose example that runs it beside the server.
- Apps pinned before the reservation release need a version bump, and
  Next.js apps a `doctor --fix`, before they can be an issuer.
- [#678](https://github.com/zitadel/nextgen/issues/678) still plans
  Zitadel-served login as its second delivery step, for the broad public
  launch, and [#1034](https://github.com/zitadel/nextgen/pull/1034) still
  describes the model. Dropping it, here and in #2307, needs product sign-off
  on both.

## Open questions

1. Is `/__nextgen` the name to make public, or does it change before the
   server ships OIDC?
2. The relying-party flag's name, and how the CLI finds the issuer's
   project.
3. The credential kind of a relying party (a client secret or
   `private_key_jwt`), and where its SDK keeps the session. An encrypted
   cookie needs a key in exactly the layer ADR 036 empties of secrets.
4. Whether `POST /flow`'s free-form `redirect_uri` goes once authorization
   requests exist. Its TODO asks for the allowlist an authorization request
   already carries.
5. Whether the server refuses clients below the security floor after GA.
6. Whether the SDK serves [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)
   protected-resource metadata for an app that hosts an MCP server. It names
   the app's own resource, so it belongs to a resource-server feature, not to
   this reservation.
7. Production rewrites on platforms that do not forward the original host:
   does the SPA need ADR 036's minimal worker there?
8. Whether account choice also shows, by a project setting, whenever a live
   session exists.
9. An SPA as a relying party: a public client that holds its tokens in the
   browser, under the OAuth guidance for browser-based apps, or a backend
   that holds them for it.
10. Whether a refresh keeps the deployment sealed at sign-in until the grant
    ends, as §10 has it, or moves to the newest deployment to the issuer's
    origin, which would carry a configuration fix to long-lived grants.
11. With the login on `auth.example.com`, passkeys bind to that full hostname
    (`passkeyRPFromOrigin`), so moving the login to another subdomain later
    breaks them. Can the relying-party ID be the registrable domain instead?
    ADR 038's related origins are the other lever.

## Rejected alternatives

### Zitadel renders the login on a custom domain

Level 3's model. It brings back a second owner for the sign-in page, which
ADR 057's amendment just removed, and adds certificate and abuse-review work
on Zitadel's side. A login app on that host does the same jobs (§2).

### Ship a prebuilt login that renders the release

An out-of-the-box SPA login for self-hosters and homelabs. The SPA itself is
little work, because the widget already renders whatever the release
carries, but it would run what was last deployed to its origin
([#536](https://github.com/zitadel/nextgen/issues/536)), not the latest
release. And it needs:

- a hostname of its own. On the server's origin it cannot sign anyone in
  ([#2297](https://github.com/zitadel/nextgen/pull/2297)); allowing that
  would put the Console and every project on one origin and bind every
  project's passkeys to the server's hostname;
- OIDC before it can give any other app a session, and, as a static bundle,
  the publishable key ([#560](https://github.com/zitadel/nextgen/issues/560))
  for the exchange.

With all of that in place it is this ADR's login app, prebuilt, and the
sign-in page has a second owner again: the reason a custom domain is
rejected above, and one that holds for self-hosters too, who run their own
certificates anyway. Customizing it beyond branding means forking it, as
users of Zitadel v4's Login V2 do today. Homelabs want an OIDC provider for
apps they did not write, such as Grafana, Gitea or Proxmox; before OIDC
exists a prebuilt login gives them nothing, and Zitadel v4 already serves
them. Developers and agents already get a local server and an app with a
working login from `zitadel start` and `zitadel setup` in an empty folder,
and MCP clients will sign in to the customer's login through OAuth (§6).
Self-hosters get a login-only setup and a compose example instead (step 4 of
the [Recommended sequence](#recommended-sequence)).

### Scaffold the OIDC routes on demand

The configuration surface's plan. Adding routes when `push` sees an IdP or a
client is a re-scaffold by another name, and it fails on a request boundary
the customer has edited. Reserving two paths now costs nothing.

### Endpoints at the app's root

`/authorize`, `/token` and `/userinfo` are common route names in an app, and
each would need a `matcher` entry. The metadata lets the endpoints live
anywhere; only the metadata's own location is fixed.

### The server creates the flow at `/authorize` and redirects with `?flow=`

The widget already resumes `?flow=`. But the flow would lose the page's
`purpose` and definition, flow creation would become a cross-site `GET`, and
the request would end with that flow when the user restarts it.

### Generated page code reads the handle

The same lines in every template of every framework, and a page that forgets
them silently drops the request. The widget reads `flow` itself for the same
reason.

### Let the proxy pass redirects that leave the app

Silent SSO would skip the login page. But every app on that SDK would accept
a proxied answer that sends its browser anywhere, and the interactive path
still needs the widget to navigate. One path for every outcome is simpler to
secure and to test.

### A server-rendered page that redirects

The server could answer silent outcomes and end session with a small HTML
page that sends the browser on, as the form post response mode does. That is
a page Zitadel renders on the customer's origin, which §1 rules out, and a
second way out of the app beside the widget.

### Serve the widget from the server

Fixes would reach apps without a deploy. But the widget would change under
every app on each server deploy, and the cloud deploys `main` continuously.
Pins would mean nothing, and every page's content security policy would have
to allow the server.

### The issuer on Zitadel's host

An issuer such as `zitadel.cloud/p/<project>` would tie tokens and passkeys
to Zitadel's domain, break the platform's invariant, and change every
relying party's configuration when the customer leaves the cloud.

## Non-goals

- The `/ui/login/` removal and ADR 057's amendment, which
  [#2307](https://github.com/zitadel/nextgen/pull/2307) makes.
- SAML and SCIM.
- Token formats, claims and lifetimes (ADR 037), including the ID token,
  which ADR 037 does not list yet, and the client resource's API.
- What else MCP clients need: protected-resource metadata on the resource
  ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)), client registration
  (dynamic, or client ID metadata documents), and resource indicators
  ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)) that set an access
  token's audience.
- Logout propagation to relying parties.
- Level 2's cookie subdomain and Level 4's hostname mapping.

## Documentation impact

This change corrects the overview's pointer to ADR 057's presentation models,
which the `/ui/login/` removal leaves behind. On acceptance:

- The platform [overview](../design/platform/overview.md) and
  [README](../design/platform/README.md): Level 1's "scaffolded later"
  paragraph, Level 2's authorization endpoints and issuer, and Levels 3
  and 4.
- [`configuration-surface.md`](../design/platform/configuration-surface.md):
  §6 and §7 replace "Proxy endpoints (scaffolded on demand)". The "Declared
  issuer origins per environment" row, the paragraph after that table and
  the Environments section's issuer rules predate ADR 068; §5 replaces what
  they say about `iss`, and §4 what they say about magic-link hostnames.
- [`resource-map.md`](../design/api/resource-map.md#hosted-protocol-surfaces):
  the hosted protocol surfaces.
- [`authn-and-auth-flows.md`](../design/api/authn-and-auth-flows.md): the
  OIDC compatibility lock and Path 3.
- The [glossary](../design/glossary.md): the *custom domain* and *project*
  rows, which give the project a custom domain for hosted login, and the
  integration levels.
- ADR 077's README summary, if both ADRs are accepted.

On implementation: the CLI's
[`SKILL.md`](../../apps/cli/skills/zitadel-cli/SKILL.md) (the reserved paths,
relying-party mode and the login-only mode), the SDK READMEs (the reserved
paths and the headers they send), the components README (the `auth_request`
parameter), the `hint.login_name` description in the API spec, and the
[compose quick start](../quick-start/docker-compose.md) (the login app beside
the server).
