# ADR 082: Zitadel as an OAuth 2.1 and OpenID Connect Server

> **Status:** Accepted
> **Date:** 2026-10-24
> **Accepted:** 2026-11-06
> **Context:** What Zitadel offers as an OAuth 2.1 and OpenID Connect server,
> and which part the server, the SDKs, the web components and the customer's
> configuration each own.
> **Builds on:** [ADR 081](081-customer-hosted-login-and-oidc-provider.md),
> which runs the authorization server on the server with the login
> application's origin as its issuer, [ADR 037](037-token-lifecycle.md), which
> fixes token formats, lifetimes and rotation, and the
> [identity model](../design/api/identity-model.md), which names the
> applications, clients and APIs this server serves.
> **Adopts:** the application half of the
> [identity model](../design/api/identity-model.md), which supersedes the app
> half of [`identity-surface.md`](../design/cli/identity-surface.md), and the
> IdP connection's shape, one document for the file and the API
> ([IdP area 1](../design/idp/1-resource-model.md)).
> **Related:** [ADR 029](029-cryptography-secrets-and-key-lifecycle.md),
> [ADR 032](032-permission-catalogs.md),
> [ADR 036](036-api-credential-planes.md),
> [ADR 039](039-signing-key-rotation-and-incident-response.md),
> [ADR 062](062-per-environment-variables-and-secrets.md),
> [ADR 064](064-cli-resource-commands.md),
> [ADR 068](068-project-is-the-data-boundary.md),
> [ADR 070](070-cli-auth-method-toggles.md),
> [ADR 078](078-abuse-prevention-in-layers.md)
>
> **Amendment (2026-11-11) — [D42](../design/decisions.md),
> [Console ADR 0004 §1](../../apps/console/docs/adrs/0004-console-deployment-modes.md#1-every-bootstrapped-deployment-has-one-reserved-platform-project):**
> an app on the reserved platform project signs people in to the platform
> itself (the Console, the CLI, MCP clients acting on Zitadel), never a
> customer's end users. When applications are built, declaring or registering
> one there asks for the project's admin role, as its other configuration
> does.

## TL;DR

- The server runs the protocol, the server SDK is its front door in the
  customer's application, `<zitadel-login>` renders every page the protocol
  needs, and configuration decides what tokens contain.
- OAuth 2.1 with OpenID Connect: the authorization code flow for every client,
  with PKCE required for public clients and optional for confidential ones,
  client credentials for services, rotating refresh tokens. No implicit or
  hybrid flow and no password grant.
- An Application is one document whether a file or an API call writes it, as
  an IdP connection is: the developer's own applications are files in the
  release, a customer's applications and dynamically registered clients are
  data. An application holds its clients and the APIs it serves, with their
  scopes and claim rules; the project's OAuth settings are a file too.
- Claims come from the user schema, from rules, and from a signed hook per
  protected API that the server calls in the customer's backend, never from
  the browser.
- The first release serves a confidential web application through an OAuth
  server. OpenID Connect, public clients, protected APIs and MCP follow.
- Every decision a developer makes has a file, a command and an SDK call or
  element (§12), where an agent finds flows and schemas.

## Context

ADR 081 decides where the authorization server runs and how a request reaches
the login page and completes. It leaves out the client resource, claims and
what MCP clients need, and none of that exists yet. The glossary calls an
OAuth client an *app* that lives in a project, and the identity model left
the name open; it is settled as *Application*, the software, which holds its
clients. The API has no application resource yet, ADR 036 puts an
application's client credentials out of scope, and ADR 037 fixes token
formats without saying what goes into them. The
[configuration surface](../design/platform/configuration-surface.md#the-split-config-vs-resources)
puts client definitions and machine credentials on the data plane and
everything that describes behavior in config, and keeps allowed redirect URI
patterns in config, which no one resource can satisfy.

Two documents already draw the line this ADR needs. ADR 064 §1 decides config
against data by owner, and names a customer-managed SSO connection as a
resource that needs both paths. The
[identity model](../design/api/identity-model.md#code-or-api) splits
applications that way: the developer's own as files in the release,
team-owned applications and third parties that registered through the API.
The IdP connection ships the shape both ask for: `.zitadel/idps/<slug>.json`
is the body of `POST /idps`
([`create-idp-request.yaml`](../../apps/api/api/openapi/endpoints/idps/create-idp-request.yaml)),
the CLI syncs the file, a role writes the API, and the server stores one
resource either way.

Customers building MCP servers ask for OAuth 2.1 and dynamic client
registration ([#375](https://github.com/zitadel/nextgen/issues/375)). MCP's
[authorization spec](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
requires OAuth 2.1 and resource indicators, recommends client ID metadata
documents, and keeps dynamic registration only for backwards compatibility.

## Decision

### 1. Who owns what

| Part | Owns |
|---|---|
| Server | Validating requests, running the flow, generating and signing tokens with the project's keys (ADR 039), and storing applications, consents and refresh tokens. |
| Server SDK, in the customer's application | The front door at the issuer (ADR 081 §7), verifying the server's tokens for the application's own APIs, and serving the claims hook (§6). |
| Web components | `<zitadel-login>` renders sign-in, account choice and consent as steps of one flow (ADR 081 §11). A connected-apps component (working name `<zitadel-connected-apps>`) lists and revokes a user's consents. |
| Configuration, in the release | The project's OAuth settings (§12) and the developer's own applications with their APIs, scopes, claim rules and hooks (§3, §5, §6). |
| Data, through the API | A customer's applications, third parties added in the Console and dynamically registered clients (§3, §9), consents and refresh tokens. |

A component decides nothing a token says, because the user controls the
browser. Where one kind of resource can have either owner, the owner decides
the path, as ADR 064 §1 has it for SSO connections, and the resource is one
document either way: a file the CLI syncs, or the same document an API call
writes. Each path has one writer: a declared resource is read-only outside
`deploy` (ADR 064 §3), and a registered one is never in `.zitadel/`.

### 2. Protocol profile

- **Authorization code for every client.** PKCE (`S256`) is required for
  public clients and optional for confidential ones
  ([RFC 9700 §2.1.1](https://www.rfc-editor.org/rfc/rfc9700#section-2.1.1)),
  and the SDK and `setup --sign-in-with` always send it. OAuth 2.1 requires
  PKCE for every client; this profile does not require it for confidential
  clients, so that an existing confidential client on the OAuth 2.0 code flow
  connects without a change. Redirect URIs match exactly; a native
  application's loopback redirect may use any port (RFC 8252). Responses carry
  `iss` ([RFC 9207](https://www.rfc-editor.org/rfc/rfc9207), ADR 081 §9).
- **Refresh tokens** rotate on every use (ADR 037). A third-party client gets
  one only when the user consents to `offline_access`.
- **Client credentials** for service applications.
- **No implicit or hybrid flow and no password grant.**
- Discovery (ADR 081 §6), JWKS, userinfo, refresh token revocation (RFC 7009)
  and RP-initiated logout. APIs validate access tokens as JWTs against the
  issuer's JWKS. Introspection (RFC 7662) comes in step 5: an API's named
  clients ask whether a token still stands, and the server answers from the
  token and the consent and revocation state, since ADR 037 stores nothing
  for access tokens.

**Until OpenID Connect ships** (step 3 of the
[Recommended sequence](#recommended-sequence)), the server is an OAuth server
only:

- It issues no ID token and serves no userinfo.
  `/.well-known/openid-configuration` stays reserved (ADR 081 §7) and answers
  404, while `/.well-known/oauth-authorization-server`
  ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)) answers from step 2.
- `openid` is not in `scopes_supported`. A standard scope the server does not
  serve yet is ignored. The token response returns the granted `scope`
  ([RFC 6749 §3.3](https://www.rfc-editor.org/rfc/rfc6749#section-3.3)). An
  API's unknown scope still ends the flow with `invalid_scope` (§5, once
  protected APIs ship in step 5).
- Step 2 signs with EdDSA only. This deviates from
  [RFC 9068 §2.1](https://www.rfc-editor.org/rfc/rfc9068#section-2.1), which
  requires RS256 among the supported algorithms. The docs name libraries
  that verify EdDSA, and the e2e lane uses one. RS256 arrives with ID tokens
  in step 3, or sooner for a customer whose library cannot verify EdDSA.

### 3. Applications

An application is one document, in the shape of
`.zitadel/applications/<slug>.json`, whoever writes it, as an IdP connection
is ([IdP area 1](../design/idp/1-resource-model.md)): the file is the body of
`POST /applications`. That call creates the application when its slug is free
in the project. It revises a registered application only when its owner calls
it, and never a declared one, whose one writer is `deploy` (§1). The slug is
unique in the project across declared and registered applications, and is
what a flow's `audience.app_ids` and branding name. An application holds the
clients its document lists and the APIs it serves (§5); a client that
registers itself references it from a record of its own (§9).

Each client has a `client_id`. The CLI generates one for each new client and
writes it into the file, so it can show the id before any deploy; a client
without one gets an id the server generates. A CLI-generated id never takes
the server's form, `client_` or `dcr_` followed by an id. Either way the id
is fixed for life, unique in the project and never reused. The release build
and `POST /applications` refuse a new client whose `client_id` takes the
server's form, and a body that changes an existing client's id. A
server-generated id sent back unchanged in an update is accepted.

Who owns the application decides the path (§1):

- **Declared:** the developer's own applications, the login application and
  its relying parties (ADR 081 §12) among them, are files in the release,
  validated against `.zitadel/meta/application.json`. The release build and
  `zitadel deploy` refuse a file whose slug a registered application in the
  project already holds, with a defined error that names the slug; moving a
  registered application into the release is an explicit step (open
  question 6).
  `zitadel application create` writes the file locally and does not deploy;
  updating an application is editing its file, then `zitadel deploy`. The
  CLI syncs the file with a `ResourceSyncer` like the connection's, mutable
  by slug. The server stores an immutable revision per edit under a stable
  application id, as it does for connections. The release pins one revision.
  `client_id` is an identity field, so no revision can change it.
  Removing a file drops the application from the next release, and once that
  serves the issuer, its grants end at their next refresh (ADR 081 §10).
  Whether removing the file also deletes the stored document is open;
  [#1013](https://github.com/zitadel/nextgen/issues/1013) decides it for
  connections and applications together.
  `deploy --dry-run` shows a redirect URI change before it ships, and a
  staging project gets the applications from the release instead of by hand.
- **Registered:** some applications and clients are data. These are a
  customer's application that the product's own UI creates through the API,
  a third party an operator adds in the Console, and a client ID metadata or
  dynamically registered client (§9). They are never in `.zitadel/`. A
  registered application uses the same document as a declared one, and is
  resolved live at its newest revision; no release pins it.
  `zitadel application create --registered` and `POST /applications` write
  registered applications, as `idp create` does for connections. A
  registered application records its owner: the principal that created it,
  and its team once team ownership ships (§11), which widens who may revise
  it. A conflict on its slug names no other application.

The credential is never in the file. A declared client authenticates with
`private_key_jwt`, its public key in the file, or with a client secret the
file names as a project variable, `"secret": "${{ SHOP_WEB_CLIENT_SECRET }}"`.
The developer picks the variable name; `zitadel application create` proposes
one, and the release build refuses a name another client in the project
already uses. The server reads it from the project's variables when the
client authenticates (ADR 062).
`zitadel application create` neither generates nor publishes a value: the
developer sets one with `zitadel variable set <NAME> --secret` and puts the
same value in the backend. Its `next_commands` are that `variable set` for a
confidential client, then `deploy --dry-run` and `deploy -m` (ADR 064 §8,
ADR 070 §2). For a registered confidential client, `POST /applications`
generates the first secret, returns it once and stores only its hash.
Credentials become a resource of their own later, for rotation (§11).

| Preset | Client type | Authenticates with | Grant types |
|---|---|---|---|
| Web | confidential | client secret or `private_key_jwt` | authorization code, refresh token |
| SPA or native | public | PKCE only | authorization code, refresh token |
| Service | confidential | client secret or `private_key_jwt` | client credentials |

A preset fills a client's fields when the CLI or the Console writes it, and
is not stored. A client keeps its `type`, public or confidential, and its
other fields, never the preset, so declared, registered and imported clients
share one shape. Any confidential client can later be a principal
([identity model](../design/api/identity-model.md#principals)). A client has
no `protocol` field: an OpenID Connect client is an OAuth client that asks
for `openid`, as in RFC 7591 and OpenID Connect Dynamic Registration, so a
client created before OpenID Connect ships needs no migration.

The party is a field of each client. A declared application's clients are
**first-party** unless the file says otherwise, and skip consent unless the
request asks for it. A registered application's clients are **third-party**
unless the role that registers them says otherwise. A client that registers
itself (§9) is always third-party, whatever application it references, and
always gets consent. Consent shows the requesting client's name and its
redirect host, and the API it asks for, as the resource. The document also
carries what ADR 081 leaves to the application: the APIs it may call (§5),
its consent policy and whether account choice shows on a live session
(ADR 081 §11), and a token lifetime (open question 3). An MCP server is not a
kind of application; it is a protected API an application holds (§10).

### 4. Issuer and deployment without a browser

A client credentials request has no authorization request to fix its issuer
(ADR 081 §5). Its issuer is the one its token endpoint's path names
(ADR 081 §6), under the same rule: a primary origin or loopback, never the
server's own origin or a preview. It resolves the newest deployment to that
origin, as a flow on that origin would, never from the request's `Origin`
header. There is no project default target: a caller with no `Origin` is
served the project's newest primary deployment
([ADR 085](085-which-release-serves-a-request.md)), but a client credentials
request still resolves from its issuer. A refresh keeps the issuer of its
refresh token and resolves the newest deployment to it, never widening the
grant (ADR 081 §10). The authorization endpoint resolves a deployment from
the origin it reached, since a declared application and its redirect URIs
are in the release (§3), and the flow it opens seals that deployment.

### 5. Protected APIs and scopes

- The OpenID Connect scopes `openid`, `profile`, `email`, `address`, `phone`
  and `offline_access` are built in.
- A **protected API** is a config inside its application's document (§3), an
  entry of its `apis`, not a file of its own. It names the API's identifier
  (its canonical URI), the scopes it defines with the text keys their consent
  lines use (§8), its access token lifetime, its claim rules and its claims
  hook (§6), whether third-party clients may request it, and the clients
  that may introspect its tokens (§2). A first-party client calls the APIs
  its application lists; a third-party client may request only APIs open to
  third parties, and consent covers the rest.
- Since a declared application's APIs and scopes are config, the flow checks
  them against the deployment it seals (ADR 081 §10), and an unknown one ends
  it with `invalid_scope` or `invalid_target`.
- An access token requested with `resource` is for exactly one API. The
  client names it with the `resource` parameter (RFC 8707), which MCP clients
  always send, and the token's `aud` is the API's identifier. A request
  without `resource` gets an access token whose `aud` is the client's
  `client_id`. Its `sub` is the user, or the client under client
  credentials. It is for the client's own backend and, once OpenID Connect
  ships, for userinfo. ID tokens never carry `typ: at+jwt`, so
  `protectResource` and any verifier of a no-resource token require it
  ([RFC 9068 §4](https://www.rfc-editor.org/rfc/rfc9068#section-4)). A
  request that names several resources fails.
- The server SDK verifies access tokens for the APIs its application hosts
  against the issuer's JWKS (ADR 081 §14), and serves their protected-resource
  metadata (RFC 9728) under `/__nextgen`, named in `WWW-Authenticate`
  (RFC 9728 §5.1), so the application gives up no third root path. This
  answers ADR 081's open question 5.

### 6. Claims

What a token says is decided on the server, where it is signed, in three
layers:

1. **Standard claims** come from the user schema. A property's `x-claim`
   names the claim it releases
   ([`user-property.json`](../../apps/api/api/openapi/endpoints/schemas/user-property.json)),
   beside `x-identifier` and `x-unique`, and the default schema gains them
   (`givenName` → `given_name`, and so on). Each scope the token carries
   releases its claims (OpenID Connect Core §5.4).
2. **Claim rules** add claims for a scope or an API, from a user property or
   a constant: a scope's rules in the project's OAuth settings (§12), an
   API's in its entry of the application's document (§5).
3. **The claims hook** covers what rules cannot reach. A protected API may
   name an HTTPS hook that the server calls while it generates a token for
   that API, with the user, the client, the scopes and the API, under the
   same fetch guards as §9. The server signs the call with the project's key;
   the server SDK serves the hook under `/__nextgen` from a handler the
   developer owns (§12) and checks the signature against the issuer's JWKS.
   The hook returns claims to add. It has a short timeout, and if it fails,
   the token request fails, unless the API's entry says its hook claims are
   optional; then the server generates the token without them and records
   the failure. So a slow backend fails the tokens of one API, never every
   sign-in, and a token never silently lacks a claim the customer relies on.

Rules and the hook cannot set reserved claims (`iss`, `sub`, `aud`, `exp`,
`iat`, `nbf`, `jti`, `azp`, `client_id`, `scope`, `nonce`, `auth_time`, `acr`,
`amr`, `sid`, `cnf`), and what they add has a size limit.

### 7. Tokens

ADR 037's rules hold: access tokens are short-lived JWTs, in RFC 9068's
profile (`typ: at+jwt`); refresh tokens are opaque and single-use; opaque
access tokens stay out of scope. Tokens are signed with the project's keys
(ADR 029, ADR 039): EdDSA from the first release, RS256 always offered once
ID tokens ship, since OpenID Connect Discovery requires it, and a client or
an API may choose ES256. `sub` is
the user's ID, and ID tokens carry `sid` so that back-channel logout can
follow.

### 8. Consent

A consent records that a user let a client use some scopes. It is kept per
user, client and scope, and is called a consent because ADR 032 uses *grant*
for permissions. The flow engine inserts the consent step (ADR 081 §11) when
a third-party client asks for scopes the user has not consented to, and
whenever a request says `prompt=consent`, and on every request for an
application whose document says so (§3). The scope descriptions on the
screen come from the API's entry (§5), translated with the release.

A user lists and revokes their consents through me endpoints, which use the
session cookie like the other me endpoints (ADR 036); the connected-apps
component calls them. Revoking a consent revokes the client's refresh tokens
for that user.

### 9. Registration

- **Declared or registered:** in files, or through the API, the Console or
  `zitadel application create --registered` (§3), first- and third-party
  alike.
- **Client ID metadata documents:** a client uses an HTTPS URL as its
  `client_id`, and the server fetches and validates the JSON document behind
  it when an authorization request names it: HTTPS only, no private or
  special-use addresses, limits on size and time, and caching. Such clients
  are third-party.
- **Dynamic client registration** (RFC 7591), kept for compatibility with
  clients that register no other way.
- Both are **off by default** in each project, because open registration is an
  abuse surface (ADR 078); a project turns them on in its OAuth settings
  (§12).
- A client registered either way **belongs to the issuer's project**, which
  answers #375's question of how dynamically registered clients map to
  projects. It registers at the project, since an endpoint per application
  would need an issuer per application. It is a record of its own that
  references the application and the API its first authorization request
  names as `resource`, as MCP requires. The application's document never
  lists it, so a deploy never revises or removes it, and each path keeps one
  writer (§1). Its consents and refresh tokens are kept with its own record.
  It stays third-party (§3), and a later request for another application's
  API is refused. Until its first request it belongs to no application,
  where [#1283](https://github.com/zitadel/nextgen/issues/1283) has every
  client belong to one.
- Both need a **login-only issuer.** Any script on the issuer's origin acts
  with the user's session (ADR 081's risks), so with open registration it
  could bring its own client, accept that client's consent itself and keep a
  refresh token. The release accepts either switch only when the OAuth
  settings declare the issuer login-only; the SDK then serves the login page
  with a strict content security policy and `frame-ancestors 'none'`, and
  `doctor` warns when the application serves other pages.

### 10. MCP

An MCP server is a protected API an application holds (§5); its hook (§6)
adds the tenant claim its tools need. With §5 and §9, any MCP client can use
it. The client finds the issuer in the protected-resource metadata the SDK
serves and the issuer's metadata under ADR 081's reserved paths, registers
with a client ID metadata document on a login-only issuer (§9), and gets a
token for the MCP server's URI with PKCE and `resource`. MCP's
enterprise-managed authorization builds on token exchange and comes with it
(§11).

### 11. Later

- Token exchange (RFC 8693), first, since delegation, impersonation and
  workload identity federation ride on it, and MCP's enterprise-managed
  authorization with them (§10).
- Device authorization (RFC 8628) for CLIs and TVs.
- Back-channel logout for third-party clients (first-party ones share the
  session, ADR 081 §12).
- Pushed authorization requests (RFC 9126).
- DPoP (RFC 9449).
- The user's roles and permissions in tokens
  ([#425](https://github.com/zitadel/nextgen/issues/425)).
- Credentials as a resource of their own, so a client holds several secrets
  and keys and rotates each without a revision of its application.
- Access to an application for users and teams, as grants on the application
  ([#1283](https://github.com/zitadel/nextgen/issues/1283)).
- An application's status, to deactivate and reactivate it (#1283).
- Team-owned applications, such as a customer's own integration (#1283).

### 12. What a developer touches

Every decision this ADR leaves to a developer has a file in the release, a
command that writes or reads it, and, where the application takes part, an
SDK call or an element; the names below are working names. The CLI describes
each kind in `zitadel resources --json` and chains the commands in
`next_commands` (ADR 064), so an agent finds them where it finds flows and
schemas.

| To | File | Command | SDK or element |
|---|---|---|---|
| Become an issuer | `.zitadel/oauth.json`, a singleton like branding: the switch (ADR 081 §7), the login-only declaration and the registration switches (§9), scope claim rules (§6) and token defaults | `zitadel settings oauth enable`, or `zitadel application create` when the issuer is off, which says so; `deploy` ships it; `doctor` checks the reserved paths and that a login-only issuer serves only the login | Nothing: the SDK already forwards the paths, and sets a login-only issuer's content security policy |
| Declare an application | `.zitadel/applications/<slug>.json` (§3) | `zitadel application create`, which writes the file and does not deploy, or `setup --sign-in-with` for a relying party (ADR 081 §12); `deploy --dry-run` and `deploy` | A relying party configures its proxy with the issuer and its client id; `auth()` and the session elements are unchanged |
| Register an application | None | `zitadel application create --registered`, or `POST /applications` | The product's own UI calls `POST /applications` through the proxy with the admin's session |
| Protect an API | The `apis` entry of the application's file (§5) | `zitadel application get` reads it; edit the file, then `deploy` | `protectResource({ api })` verifies bearers and serves the API's metadata |
| Add claims from the backend | The hook's URL and policy in the API's entry (§6) | `zitadel application get` reads it; edit the file, then `deploy` | `defineClaimsHook()` in a file the developer owns, served under `/__nextgen` |
| Show and revoke consents | None | None | The connected-apps element (§8) |

## Recommended sequence

1. This ADR, with ADR 081.
2. Applications, declared and registered, with client secrets and the web
   preset, without refresh tokens, with first-party clients only: until
   consent ships (step 5), the server refuses an authorization request from
   a third-party client, and one with `prompt=consent`. The error is
   `unauthorized_client`, with a description that names consent. This
   includes a registered application's clients, third-party by default (§3),
   so #1283's partner integrations wait for step 5. With them come the
   per-project switch and RFC 8414 metadata;
   the authorization endpoint, the token endpoint with `client_secret_basic`
   and `client_secret_post`, and JWKS with EdDSA; the customer-hosted login
   answering authorization requests (ADR 081's step 3); an end-to-end lane
   with an OAuth library, with and without PKCE. `iss` may ship after step 2,
   since adding it later breaks no client; the lane asserts `iss` once it
   ships and, until then, asserts that the metadata does not advertise
   `authorization_response_iss_parameter_supported`
   ([RFC 9207 §3](https://www.rfc-editor.org/rfc/rfc9207#section-3)).
3. OpenID Connect: the ID token with `nonce`, `auth_time` and `sid`;
   `openid-configuration`; RS256; the standard scopes released by `x-claim`;
   userinfo; the conformance suite as an e2e lane.
4. Public clients with required PKCE, refresh tokens with rotation and
   revocation, RP-initiated logout and key rotation.
5. Protected APIs inside applications with `resource`, per-API lifetimes,
   claim rules and the claims hook; consent, its me endpoints and the
   connected-apps element; introspection (RFC 7662) per API, for the clients
   the API names; client ID metadata documents and dynamic registration on a
   login-only issuer; MCP.
6. Service applications: client credentials and `private_key_jwt`; token
   exchange.

From step 3 on, the e2e lane runs the OpenID Foundation's
[conformance suite](https://gitlab.com/openid/conformance-suite) against a
scaffolded issuer, with the OP test plans for what has shipped, since the
protocol spans the server, the SDK proxy and the widget.

## Consequences

### Positive

- Each part has one owner, and customers shape scopes and claims without
  writing protocol code.
- No weak grant from the start leaves nothing to retire later.
- An existing web application with a backend connects from the first release
  (step 2) with any OAuth library.
- An off-the-shelf OpenID Connect library connects from step 3.
- Claims are decided where tokens are signed, so a user cannot forge them.
- The product's own applications travel with the release: a staging project
  gets them from `deploy`, and `deploy --dry-run` shows a redirect URI change
  before it ships.
- A removed application, API, scope or claim rule reaches live grants at
  their next refresh (ADR 081 §10).
- Each decision has one home (§12), so `resources --json`, the scaffolded
  READMEs and the skill can describe it.

### Negative / Risks

- Relying parties on the implicit flow, the hybrid flow
  (`response_type=code id_token`) or the password grant must move to the
  code flow first.
- The claims hook puts the customer's backend on the token path: a slow or
  failing hook fails the tokens of its API, and the sign-ins that need one.
- One shape, two writers: a declared application is read-only in the Console
  and the API, a registered one cannot be edited as a file, and moving a
  registered application into the release is an explicit step (open
  question 6).
- A registered application can hold a slug the developer later wants to
  declare; the release build then refuses the file, and the developer picks
  another slug.
- An access token stays valid until it expires, five minutes by default
  (ADR 037), even after its consent is revoked; from step 5 an API that must
  know sooner has the clients it names introspect (§2), and an API that only
  checks the JWT keeps the gap.
- Client ID metadata documents make the server fetch URLs that clients
  choose; the guards in §9 must hold.
- A client that calls two APIs keeps two access tokens.

## Open questions

1. Whether an application may name a hook for its ID tokens, as an API does
   for its access tokens (§6), or ID tokens and userinfo carry standard and
   rule claims only.
2. Pairwise subject identifiers for third-party clients, so they cannot
   correlate users by `sub`.
3. Which lifetime wins when an application and an API both set one.
4. Which sources besides the user's schema properties claim rules may read:
   teams, the project, the application.
5. Whether the connected-apps component is its own element or part of
   `<zitadel-session>`, and its name.
6. How a registered application moves into the release, since the release
   build refuses a file that takes its slug (§3).

## Rejected alternatives

- **A separate `<zitadel-oidc-server>` component for the OIDC pages.** Consent
  would sit on a page the customer builds, which could leave it out, and two
  elements would share one flow's state. One orchestrator keeps consent a step
  no page can drop (ADR 081 §11).
- **Every application a data-plane resource,** as the configuration surface's
  split table has it. The product's own applications would be the one part of
  the product not in its repository: a staging project needs each registered
  again by hand, `deploy --dry-run` cannot warn on a redirect URI change, and
  the identity model and ADR 064 §1 already decide otherwise.
- **A second resource kind for declared applications.** The IdP connection
  shows one document serving both writers; two kinds would need two
  meta-schemas, two listings and a migration between them.
- **Protected APIs as files of their own.** An API would be a second document
  for one application, so two writers could change what it serves, where the
  identity model writes an application with every config it holds in one
  document.
- **PKCE required for confidential clients too,** as OAuth 2.1 has it. A
  confidential client already authenticates at the token endpoint, and an
  existing client on the OAuth 2.0 code flow would need a change to connect.
- **A project-wide claims hook.** A slow backend would fail every sign-in, ID
  tokens for clients that need no custom claim included.
- **Claims decided by a web component.** The user controls the browser.
- **Only rules, or only a hook.** Rules cannot reach data outside Zitadel; a
  hook alone makes every customer run a service for what a rule could add.
- **Implicit, hybrid or password grants for older relying parties.** OAuth 2.1
  drops them: they put tokens in URLs or hand passwords to clients.
- **Several audiences per access token.** Each API could replay a token at the
  others.
- **Open registration on by default, or on an issuer that serves more than
  the login.** Anyone could create clients in a project (ADR 078), and any
  script on a shared origin could consent for one (§9).
- **Calling consents grants.** ADR 032's grants are permissions.

## Non-goals

- SAML and SCIM.
- Roles and permissions in tokens (#425), and organizations inside a project.
- Agent identity beyond token exchange (#375).
- OpenID certification, though the conformance suite runs in an e2e lane
  ([Recommended sequence](#recommended-sequence)), and the FAPI profiles.

## Documentation impact

On acceptance:

- the [glossary](../design/glossary.md): *application* replaces *app* and
  gains its presets and first- and third-party, *client* gets a row, and
  *consent*, *protected API* and *claims hook* get rows;
- the [configuration surface](../design/platform/configuration-surface.md):
  its split table, where the redirect URI and client definition rows become
  declared applications in config and registered applications as data, and
  protected APIs inside applications, `x-claim`, claim rules, the hook and
  the registration switches;
- the [identity surface](../design/cli/identity-surface.md): its app half is
  superseded by the [identity model](../design/api/identity-model.md) (§3),
  and its `role: "server"` question stays open with SAML;
- the [resource map](../design/api/resource-map.md): the application resource
  and the consent me endpoints;
- the [auth flows design](../design/api/authn-and-auth-flows.md): Path 3 gains
  client credentials and the consent step.

On implementation: the API spec, the meta-schema and README for applications
under [`packages/config/defaults/`](../../packages/config/defaults/),
`zitadel resources --json`, the CLI's
[`SKILL.md`](../../apps/cli/skills/zitadel-cli/SKILL.md), the SDK READMEs and
the components README.

## Changes since proposed

Decided on 2026-11-06 and 2026-11-09 in
[#2785](https://github.com/zitadel/nextgen/issues/2785) and
[#2864](https://github.com/zitadel/nextgen/pull/2864), to match the
[identity model](../design/api/identity-model.md), before acceptance:

- App is renamed Application: `/applications`, `zitadel application`,
  `.zitadel/applications/<slug>.json`, the Console and the docs. A client
  stays a client.
- PKCE (§2) is required for public clients and optional for confidential
  ones, where the proposal required it for every client. The review asked to
  keep it required, because making it mandatory later breaks every client
  that started without it. This profile does not make it mandatory for
  confidential clients, so none breaks.
- `iss` on authorization responses (§2) stays required, as the review asked.
  It may ship after step 2, since adding it breaks no client.
- `zitadel application create` writes `.zitadel/oauth.json` when the issuer
  is off, and `zitadel settings oauth enable` stays for doing that alone
  (§12), under a `settings` group that later protocol switches share.
- A request without `resource` (§5) gets an access token for the client's
  own backend, and for userinfo once OpenID Connect ships, where the proposal
  made it a userinfo-only token.
- The recommended sequence starts with a confidential web application
  through an OAuth server; OpenID Connect, public clients, protected APIs and
  MCP follow, and §2 says what holds until OpenID Connect ships.
- Declared applications (§3) sync mutable by slug, the server keeps an
  immutable revision per edit and the release pins one; the CLI generates a
  new client's `client_id`, which no revision can change.
- A declared client's secret is a project variable the developer sets; a
  registered client's first secret comes from `POST /applications` (§3).
- Application kinds become presets, which are not stored, and clients lose
  `protocol` (§3).
- The party is a field of each client, so a self-registering client never
  inherits first-party from the application it references (§3).
- §3 gains the owner and slug rules: `POST /applications` revises only for
  the owner, the slug is unique across declared and registered applications,
  the release build refuses a file whose slug a registered application
  holds, and a registered application is resolved live, unpinned by any
  release.
- APIs are a config of their application (§5), with no files and no command
  of their own; the scaffold for the claims hook goes (§12).
- §9 says how a self-registering client references an application from a
  record of its own, outside the application's document; introspection per
  API comes in step 5; and §11 gains credentials as a resource, grants on
  applications, an application's status and team-owned applications, with
  token exchange first.
- The risks name the hybrid flow beside the implicit flow and the password
  grant.
- `plan` and `apply` read as `zitadel deploy --dry-run` and `zitadel deploy`.

ADR 081 is amended separately. Its follow-up must change:

- the old app directory and command names in §7 and §12, which read as
  `.zitadel/applications/<slug>.json`, `zitadel application create` and
  `zitadel settings oauth enable`;
- §7's "the §6 documents exist only while it is on", since
  `openid-configuration` answers 404 until step 3 here (§2);
- §7's rule that turning the switch on declares the login application, which
  §12 here does not do yet;
- §12's rule that a registered application whose slug a file later declares
  becomes declared at the next `apply`, and its printed file for a relying
  party registered through the API: §3 here refuses such a file, so §12 must
  say how a registered relying party is moved into the release (open
  question 6) instead;
- its step 3, which bundles PKCE, `iss` and userinfo into "ADR 082's step 2";
- §12's `resource` that defaults to the issuer's own API, which §5 here
  does not define.

ADR 037's introspection note, that introspection needs a stored token or
token id, is amended by step 5 here: the server answers from the JWT and the
consent and revocation state.
