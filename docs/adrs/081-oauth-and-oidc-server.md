# ADR 081: Zitadel as an OAuth 2.1 and OpenID Connect Server

> **Status:** Proposed
> **Date:** 2026-10-24
> **Context:** What Zitadel offers as an OAuth 2.1 and OpenID Connect server,
> and which part the server, the SDKs, the web components and the customer's
> configuration each own.
> **Builds on:** [ADR 080](080-customer-hosted-login-and-oidc-provider.md),
> which runs the authorization server on the server with the login app's
> origin as its issuer, and [ADR 037](037-token-lifecycle.md), which fixes
> token formats, lifetimes and rotation.
> **Adopts:** the app half of
> [`identity-surface.md`](../design/cli/identity-surface.md), and the IdP
> connection's shape, one document for the file and the API
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

## TL;DR

- The server runs the protocol, the server SDK is its front door in the
  customer's app, `<zitadel-login>` renders every page the protocol needs, and
  configuration decides what tokens contain.
- OAuth 2.1 with OpenID Connect: the authorization code flow with PKCE for
  every client, client credentials for services, rotating refresh tokens. No
  implicit flow and no password grant.
- An app is one document whether a file or an API call writes it, as an IdP
  connection is: the developer's own apps are files in the release, a
  customer's apps and dynamically registered clients are data. Protected
  APIs, scopes, claim rules and the project's OAuth settings are files too.
- Claims come from the user schema, from rules, and from a signed hook per
  protected API that the server calls in the customer's backend, never from
  the browser.
- The first release serves MCP clients: consent, protected APIs and client
  ID metadata documents on a login-only issuer. Declared apps, claim rules,
  dynamic registration and services follow.
- Every decision a developer makes has a file, a command and an SDK call or
  element (§12), where an agent finds flows and schemas.

## Context

ADR 080 decides where the authorization server runs and how a request reaches
the login page and completes. It leaves out the client resource, claims and
what MCP clients need, and none of that exists yet. The glossary calls an
OAuth client an *app* that lives in a project, but the API has no app
resource, ADR 036 puts per-app client credentials out of scope, and ADR 037
fixes token formats without saying what goes into them. The
[configuration surface](../design/platform/configuration-surface.md#the-split-config-vs-resources)
puts client definitions and machine credentials on the data plane and
everything that describes behavior in config, and keeps allowed redirect URI
patterns in config, which no one resource can satisfy.

Two documents already draw the line this ADR needs. ADR 064 §1 decides config
against data by owner, and names a customer-managed SSO connection as a
resource that needs both paths. The
[identity surface](../design/cli/identity-surface.md) splits apps that way:
first-party apps and machine clients as `.zitadel/apps/<slug>.json`,
customer-managed apps and dynamic registration through the runtime API. The
IdP connection ships the shape both ask for: `.zitadel/idps/<slug>.json` is
the body of `POST /idps`
([`create-idp-request.yaml`](../../api/openapi/endpoints/idps/create-idp-request.yaml)),
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
| Server | Validating requests, running the flow, minting and signing tokens with the project's keys (ADR 039), and storing apps, consents and refresh tokens. |
| Server SDK, in the customer's app | The front door at the issuer (ADR 080 §7), verifying the server's tokens for the app's own APIs, and serving the claims hook (§6). |
| Web components | `<zitadel-login>` renders sign-in, account choice and consent as steps of one flow (ADR 080 §11). A connected-apps component (working name `<zitadel-connected-apps>`) lists and revokes a user's consents. |
| Configuration, in the release | The project's OAuth settings (§12), the developer's own apps (§3), and protected APIs with their scopes, claim rules and hooks (§5, §6). |
| Data, through the API | A customer's apps, third parties added in the Console and dynamically registered clients (§3, §9), consents and refresh tokens. |

A component decides nothing a token says, because the user controls the
browser. Where one kind of resource can have either owner, the owner decides
the path, as ADR 064 §1 has it for SSO connections, and the resource is one
document either way: a file the CLI syncs, or the same document an API call
writes. Each path has one writer: a declared resource is read-only outside
`apply` (ADR 064 §3), and a registered one is never in `.zitadel/`.

### 2. Protocol profile

- **Authorization code with PKCE (`S256`) for every client,** confidential
  ones included. Redirect URIs match exactly; a native app's loopback redirect
  may use any port (RFC 8252). Responses carry `iss` (ADR 080 §9).
- **Refresh tokens** rotate on every use (ADR 037). A third-party app gets one
  only when the user consents to `offline_access`.
- **Client credentials** for service apps.
- **No implicit or hybrid flow and no password grant.**
- Discovery (ADR 080 §6), JWKS, userinfo, refresh token revocation (RFC 7009)
  and RP-initiated logout. There is no introspection endpoint: ADR 037 stores
  nothing for access tokens, so APIs validate them as JWTs against the
  issuer's JWKS.

### 3. Apps

An app is one document, in the shape of `.zitadel/apps/<slug>.json`, whoever
writes it, as an IdP connection is
([IdP area 1](../design/idp/1-resource-model.md)): the file is the body of
`POST /apps`, which creates the app or revises it by slug, and the server
mints the client id at create and keeps it across revisions, as it keeps a
connection id. The slug is what a flow's `audience.app_ids`, a protected API
(§5) and branding name. Who owns the app decides the path (§1):

- **Declared:** the developer's own apps, the login app and its relying
  parties (ADR 080 §12) among them, are files in the release, validated
  against `.zitadel/meta/app.json` and synced by a `ResourceSyncer` like the
  connection's (`mutable`, not `revisioned`). Removing a file drops the app
  from the next release, and once that serves the issuer, its grants end at
  their next refresh (ADR 080 §10); deleting the stored document is decided
  with the connection's ([#1013](https://github.com/zitadel/nextgen/issues/1013)).
  `plan` shows a redirect URI change before it ships, and a
  staging project gets the apps from the release instead of by hand. The
  credential is never in the file: a declared app authenticates with
  `private_key_jwt`, its public key in the file, or with a client secret the
  file names as `${{ NAME }}` and the server reads from the project's
  variables when the client authenticates (ADR 062). The server never
  generates it.
- **Registered:** a customer's app that the product's own UI creates through
  the API, a third party an operator adds in the Console, and a client ID
  metadata or dynamically registered client (§9) are data, written with the
  same document and never in `.zitadel/`. The server generates a registered
  app's secret, shows it once and stores it hashed.

| Kind | Client type | Authenticates with | Grant types |
|---|---|---|---|
| Web app | confidential | client secret or `private_key_jwt` | authorization code, refresh token |
| SPA or native app | public | PKCE only | authorization code, refresh token |
| Service | confidential | client secret or `private_key_jwt` | client credentials |

The party is a field of the document. A declared app is **first-party**
unless its file says otherwise, and skips consent unless the request asks for
it; a registered app is **third-party** unless the role that registers it
says otherwise, and always gets consent, which shows the app's name and its
redirect host. The document also carries what ADR 080 leaves to the app: the
APIs it may call and its default `resource` (§5), its consent policy and
whether account choice shows on a live session (ADR 080 §11), and a token
lifetime (open question 3). An MCP server is not a kind of app; it is a
protected API (§10).

### 4. Issuer and deployment without a browser

A client credentials request has no authorization request to fix its issuer
(ADR 080 §5). Its issuer is the one its token endpoint's path names
(ADR 080 §6), under the same rule: a primary pattern or loopback, never the
server's own origin or a preview. It resolves the newest deployment to that
origin, as a flow on that origin would, never from the request's `Origin`
header and never from the project default target. A refresh keeps the issuer
of its refresh token and resolves the newest deployment to it, never widening
the grant (ADR 080 §10). The authorization endpoint resolves a deployment
from the origin it reached, since a declared app and its redirect URIs are in
the release (§3), and the flow it opens seals that deployment.

### 5. Protected APIs and scopes

- The OpenID Connect scopes `openid`, `profile`, `email`, `address`, `phone`
  and `offline_access` are built in.
- A **protected API** is a file, `.zitadel/apis/<slug>.json`, validated
  against `.zitadel/meta/api.json` and synced like an app (§3). It names the
  API's identifier (its canonical URI), the scopes it defines with the text
  keys their consent lines use (§8), its access token lifetime, its claim
  rules and its claims hook (§6), and whether third-party apps may request
  it. A declared app lists the APIs it calls; a registered app may request
  only APIs open to third parties, and consent covers the rest.
- Since scopes and APIs are config, the flow checks them against the
  deployment it seals (ADR 080 §10), and an unknown one ends it with
  `invalid_scope` or `invalid_target`.
- An access token is for exactly one API. The client names it with the
  `resource` parameter (RFC 8707), which MCP clients always send, and the
  token's `aud` is the API's identifier. Without `resource`, the token is for
  userinfo only; a request that names several resources fails.
- The server SDK verifies access tokens for the APIs its app hosts against the
  issuer's JWKS (ADR 080 §14), and serves their protected-resource metadata
  (RFC 9728) under `/__nextgen`, named in `WWW-Authenticate` (RFC 9728 §5.1),
  so the app gives up no third root path. This answers ADR 080's open
  question 5.

### 6. Claims

What a token says is decided on the server, where it is signed, in three
layers:

1. **Standard claims** come from the user schema. A property's `x-claim`
   names the claim it releases
   ([`user-property.json`](../../api/openapi/endpoints/schemas/user-property.json)),
   beside `x-identifier` and `x-unique`, and the default schema gains them
   (`givenName` → `given_name`, and so on). Each scope the token carries
   releases its claims (OpenID Connect Core §5.4).
2. **Claim rules** add claims for a scope or an API, from a user property or
   a constant: a scope's rules in the project's OAuth settings (§12), an
   API's in its file (§5).
3. **The claims hook** covers what rules cannot reach. A protected API may
   name an HTTPS hook that the server calls while it mints a token for that
   API, with the user, the app, the scopes and the API, under the same fetch
   guards as §9. The server signs the call with the project's key; the server
   SDK serves the hook under `/__nextgen` from a handler the developer owns
   (§12) and checks the signature against the issuer's JWKS. The hook returns
   claims to add. It has a short timeout, and if it fails, the token request
   fails, unless the API's file says its hook claims are optional; then the
   token is minted without them and the failure is recorded. So a slow
   backend fails the tokens of one API, never every sign-in, and a token
   never silently lacks a claim the customer relies on.

Rules and the hook cannot set reserved claims (`iss`, `sub`, `aud`, `exp`,
`iat`, `nbf`, `jti`, `azp`, `client_id`, `scope`, `nonce`, `auth_time`, `acr`,
`amr`, `sid`, `cnf`), and what they add has a size limit.

### 7. Tokens

ADR 037's rules hold: access tokens are short-lived JWTs, in RFC 9068's
profile (`typ: at+jwt`); refresh tokens are opaque and single-use; opaque
access tokens stay out of scope. Tokens are signed with the project's keys
(ADR 029, ADR 039). RS256 is always offered, since OpenID Connect Discovery
requires it for ID tokens, and an app or an API may choose ES256. `sub` is the
user's ID, and ID tokens carry `sid` so that back-channel logout can follow.

### 8. Consent

A consent records that a user let an app use some scopes. It is kept per user,
app and scope, and is called a consent because ADR 032 uses *grant* for
permissions. The flow engine inserts the consent step (ADR 080 §11) when a
third-party app asks for scopes the user has not consented to, and whenever a
request says `prompt=consent`, and on every request for an app whose
document says so (§3). The scope descriptions on the screen come from the
API's file (§5), translated with the release.

A user lists and revokes their consents through me endpoints, which use the
session cookie like the other me endpoints (ADR 036); the connected-apps
component calls them. Revoking a consent revokes the app's refresh tokens for
that user.

### 9. Registration

- **Declared or registered:** in files, or through the API, the Console or
  the CLI's resource command (§3), first- and third-party alike.
- **Client ID metadata documents:** a client uses an HTTPS URL as its
  `client_id`, and the server fetches and validates the JSON document behind
  it when an authorization request names it: HTTPS only, no private or
  special-use addresses, limits on size and time, and caching. Such clients
  are third-party.
- **Dynamic client registration** (RFC 7591), kept for compatibility with
  clients that register no other way.
- Both are **off by default** in each project, because open registration is an
  abuse surface (ADR 078); a project turns them on in its OAuth settings
  (§12). A client registered either way belongs to the issuer's project,
  which answers #375's question of how dynamically registered clients map to
  projects.
- Both need a **login-only issuer.** Any script on the issuer's origin acts
  with the user's session (ADR 080's risks), so with open registration it
  could bring its own client, accept that client's consent itself and keep a
  refresh token. The release accepts either switch only when the OAuth
  settings declare the issuer login-only; the SDK then serves the login page
  with a strict content security policy and `frame-ancestors 'none'`, and
  `doctor` warns when the app serves other pages.

### 10. MCP

An MCP server is a protected API (§5) that a customer's app hosts; its hook
(§6) adds the tenant claim its tools need. With §5 and §9, any MCP client can
use it. The client finds the issuer in the protected-resource metadata the
SDK serves and the issuer's metadata under ADR 080's reserved paths,
registers with a client ID metadata document on a login-only issuer (§9),
and gets a token for the MCP server's URI with PKCE and `resource`. MCP's
enterprise-managed authorization builds on token exchange and comes with it
(§11).

### 11. Later

Device authorization (RFC 8628) for CLIs and TVs, token exchange (RFC 8693)
for delegation and agents, back-channel logout for third-party apps
(first-party ones share the session, ADR 080 §12), pushed authorization
requests (RFC 9126), DPoP (RFC 9449), and the user's roles and permissions in
tokens ([#425](https://github.com/zitadel/nextgen/issues/425)).

### 12. What a developer touches

Every decision this ADR leaves to a developer has a file in the release, a
command that writes or reads it, and, where the app takes part, an SDK call
or an element; the names below are working names. The CLI describes each
kind in `zitadel resources --json` and chains the commands in
`next_commands` (ADR 064), so an agent finds them where it finds flows and
schemas.

| To | File | Command | SDK or element |
|---|---|---|---|
| Become an issuer | `.zitadel/oauth.json`, a singleton like branding: the switch (ADR 080 §7), the login-only declaration and the registration switches (§9), scope claim rules (§6) and token defaults | `zitadel oauth enable`, which writes the file as ADR 070's commands write theirs; `doctor` checks the reserved paths, and that a login-only issuer serves only the login | Nothing: the SDK already forwards the paths, and sets a login-only issuer's content security policy |
| Declare an app | `.zitadel/apps/<slug>.json` (§3) | `zitadel apps create`, or `setup --sign-in-with` for a relying party (ADR 080 §12); `plan` and `apply` | A relying party configures its proxy with the issuer and its client id; `auth()` and the session elements are unchanged |
| Let a customer register an app | None | The product's own UI calls `POST /apps` through the proxy with the admin's session; `apps` resource commands for operators | None |
| Protect an API | `.zitadel/apis/<slug>.json` (§5) | `zitadel apis create` | `protectResource({ api })` verifies bearers and serves the API's metadata |
| Add claims from the backend | The hook's URL and policy in the API's file (§6) | `zitadel apis create --hook` scaffolds the handler | `defineClaimsHook()` in a scaffolded file the developer owns, served under `/__nextgen` |
| Show and revoke consents | None | None | The connected-apps element (§8) |

## Recommended sequence

1. This ADR, with ADR 080.
2. The first release serves MCP clients, with ADR 080's steps 3 and 5: the
   OAuth settings file with its switch, which declares the login app
   (ADR 080 §7), and the login-only declaration; client ID metadata
   documents; the code flow with PKCE and refresh rotation for public
   clients; discovery, JWKS, token and userinfo; consent, its me endpoints
   and the connected-apps element; and protected APIs with their files,
   resource indicators and scopes, and the SDK's verification and
   protected-resource metadata.
3. Declared apps with their commands, registered apps through the API, and
   confidential web apps with client secrets; the standard scopes released by
   `x-claim`; per-API lifetimes, claim rules, the claims hook and its
   scaffolded handler; refresh token revocation.
4. Dynamic registration, for MCP clients that register no other way.
5. Service apps: client credentials and `private_key_jwt`.

From step 2 on, an e2e lane runs the OpenID Foundation's
[conformance suite](https://gitlab.com/openid/conformance-suite) against a
scaffolded issuer, with the OP test plans for what has shipped, since the
protocol spans the server, the SDK proxy and the widget.

## Consequences

### Positive

- Each part has one owner, and customers shape scopes and claims without
  writing protocol code.
- OAuth 2.1 from the start leaves no weak grant to retire later.
- MCP clients work against a customer's app from the first release (step 2),
  without the custom auth proxies #375 describes.
- Claims are decided where tokens are signed, so a user cannot forge them.
- The product's own apps travel with the release: a staging project gets them
  from `apply`, and `plan` shows a redirect URI change before it ships.
- A removed app, API, scope or claim rule reaches live grants at their next
  refresh (ADR 080 §10).
- Each decision has one home (§12), so `resources --json`, the scaffolded
  READMEs and the skill can describe it.

### Negative / Risks

- Relying parties on the implicit flow or the password grant must move to the
  code flow with PKCE first.
- The claims hook puts the customer's backend on the token path: a slow or
  failing hook fails the tokens of its API, and the sign-ins that need one.
- One shape, two writers: a declared app is read-only in the Console and the
  API, a registered one cannot be edited as a file, and moving a registered
  app into the release is an explicit step (open question 6).
- Without introspection, an access token stays valid until it expires, five
  minutes by default (ADR 037), even after its consent is revoked.
- Client ID metadata documents make the server fetch URLs that clients
  choose; the guards in §9 must hold.
- A client that calls two APIs keeps two access tokens.

## Open questions

1. Whether an app may name a hook for its ID token, as an API does for its
   access token (§6), or ID tokens and userinfo carry standard and rule
   claims only.
2. Pairwise subject identifiers for third-party apps, so they cannot correlate
   users by `sub`.
3. Which lifetime wins when an app and an API both set one.
4. Which sources besides the user's schema properties claim rules may read:
   teams, the project, the app.
5. Whether the connected-apps component is its own element or part of
   `<zitadel-session>`, and its name.
6. Whether the server slugs a registered app, so the Console,
   `resources --json` and a later file can name it, and how a registered app
   moves into the release.

## Rejected alternatives

- **A separate `<zitadel-oidc-server>` component for the OIDC pages.** Consent
  would sit on a page the customer builds, which could leave it out, and two
  elements would share one flow's state. One orchestrator keeps consent a step
  no page can drop (ADR 080 §11).
- **Every app a data-plane resource,** as the configuration surface's split
  table has it. The product's own apps would be the one part of the product
  not in its repository: a staging project needs each registered again by
  hand, `plan` cannot warn on a redirect URI change, and the identity surface
  and ADR 064 §1 already decide otherwise.
- **A second resource kind for declared apps.** The IdP connection shows one
  document serving both writers; two kinds would need two meta-schemas, two
  listings and a migration between them.
- **A project-wide claims hook.** A slow backend would fail every sign-in, ID
  tokens for apps that need no custom claim included.
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

- the [glossary](../design/glossary.md): *app* gains its kinds and first- and
  third-party, and *consent*, *protected API* and *claims hook* get rows;
- the [configuration surface](../design/platform/configuration-surface.md):
  its split table, where the redirect URI and client definition rows become
  declared apps in config and registered apps as data, and protected APIs,
  `x-claim`, claim rules, the hook and the registration switches;
- the [identity surface](../design/cli/identity-surface.md): its app half is
  adopted (§3), and its `role: "server"` question stays open with SAML;
- the [resource map](../design/api/resource-map.md): the app resource and the
  consent me endpoints;
- the [auth flows design](../design/api/authn-and-auth-flows.md): Path 3 gains
  client credentials and the consent step.

On implementation: the API spec, the meta-schemas and READMEs for apps and
APIs under [`packages/config/defaults/`](../../packages/config/defaults/),
`zitadel resources --json`, the CLI's
[`SKILL.md`](../../apps/cli/skills/zitadel-cli/SKILL.md), the SDK READMEs and
the components README.
