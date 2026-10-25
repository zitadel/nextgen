# ADR 081: Zitadel as an OAuth 2.1 and OpenID Connect Server

> **Status:** Proposed
> **Date:** 2026-10-24
> **Context:** What Zitadel offers as an OAuth 2.1 and OpenID Connect server,
> and which part the server, the SDKs, the web components and the customer's
> configuration each own.
> **Builds on:** [ADR 080](080-customer-hosted-login-and-oidc-provider.md),
> which runs the authorization server on the server behind the login app's
> origin, and [ADR 037](037-token-lifecycle.md), which fixes token formats,
> lifetimes and rotation.
> **Related:** [ADR 029](029-cryptography-secrets-and-key-lifecycle.md),
> [ADR 032](032-permission-catalogs.md),
> [ADR 036](036-api-credential-planes.md),
> [ADR 039](039-signing-key-rotation-and-incident-response.md),
> [ADR 064](064-cli-resource-commands.md),
> [ADR 068](068-project-is-the-data-boundary.md),
> [ADR 078](078-abuse-prevention-in-layers.md)

## TL;DR

- The server runs the protocol, the server SDK is its front door in the
  customer's app, `<zitadel-login>` renders every page the protocol needs, and
  configuration decides what tokens contain.
- OAuth 2.1 with OpenID Connect: the authorization code flow with PKCE for
  every client, client credentials for services, rotating refresh tokens. No
  implicit flow and no password grant.
- Apps are project data of three kinds, each first- or third-party. Protected
  APIs, scopes and claim rules are config.
- Claims come from the user schema, from rules, and from a signed hook the
  server calls in the customer's backend, never from the browser.
- Third-party apps get consent from the first release. Client ID metadata
  documents, which MCP clients use, follow in the next.

## Context

ADR 080 decides where the authorization server runs and how a request reaches
the login page and completes. It leaves out the client resource, claims and
what MCP clients need, and none of that exists yet. The glossary calls an
OAuth client an *app* that lives in a project, but the API has no app
resource, ADR 036 puts per-app client credentials out of scope, and ADR 037
fixes token formats without saying what goes into them. The
[configuration surface](../design/platform/configuration-surface.md#the-split-config-vs-resources)
puts client definitions and machine credentials on the data plane and
everything that describes behavior in config.

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
| Configuration | Protected APIs, scopes, claim rules and token settings, in the release. Apps and consents are data. |

A component decides nothing a token says, because the user controls the
browser.

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

An app is a data-plane resource of a project (ADR 068), managed through the
API, the Console and the CLI's resource commands (ADR 064):

| Kind | Client type | Authenticates with | Grant types |
|---|---|---|---|
| Web app | confidential | client secret or `private_key_jwt` | authorization code, refresh token |
| SPA or native app | public | PKCE only | authorization code, refresh token |
| Service | confidential | client secret or `private_key_jwt` | client credentials |

An app the customer registers for their own product, relying-party-mode apps
included (ADR 080 §12), is **first-party** and skips consent unless the
request asks for it. Every other app is **third-party** and always gets
consent, which shows the app's name and its redirect host. The server
generates client secrets, shows them once and stores them hashed.

### 4. Issuer and deployment without a browser

A client credentials request has no authorization request to fix its issuer
(ADR 080 §5). Its issuer is the origin the token request reached through the
proxy, under the same rule: a primary pattern or loopback, never the server's
own origin or a preview. It resolves the newest deployment to that origin, as
a flow on that origin would, never from the request's `Origin` header and
never from the project default target. A refresh keeps the issuer and the
deployment of its refresh token (ADR 080 §10).

### 5. Protected APIs and scopes

- The OpenID Connect scopes `openid`, `profile`, `email`, `address`, `phone`
  and `offline_access` are built in.
- A **protected API** is declared in config with its identifier (its
  canonical URI), the scopes it defines and its access token lifetime. An app
  may request only the scopes of APIs it is allowed to call.
- Since scopes and APIs are config, the flow checks them against the
  deployment it seals (ADR 080 §10), and an unknown one ends it with
  `invalid_scope` or `invalid_target`.
- An access token is for exactly one API. The client names it with the
  `resource` parameter (RFC 8707), which MCP clients always send, and the
  token's `aud` is the API's identifier. Without `resource`, the token is for
  userinfo only; a request that names several resources fails.
- The server SDK verifies access tokens for the APIs its app hosts against the
  issuer's JWKS (ADR 080 §14), and serves their protected-resource metadata
  (RFC 9728). This answers ADR 080's open question 6.

### 6. Claims

What a token says is decided on the server, where it is signed, in three
layers:

1. **Standard claims** come from the user schema. A claim mapping in config
   names the schema property behind each OpenID Connect claim, and the
   default schema ships with one (`givenName` → `given_name`, and so on). Each
   scope the token carries releases its claims (OpenID Connect Core §5.4).
2. **Claim rules** in config add claims for a scope or an API, from a user
   property or a constant.
3. **The claims hook** covers what rules cannot reach. A project may configure
   an HTTPS hook that the server calls while it mints a token, with the user,
   the app, the scopes and the API, under the same fetch guards as §9. The
   server signs the call with the project's key; the server SDK can serve the
   hook under `/__nextgen` and checks the signature against the issuer's
   JWKS. The hook returns claims to add. It has a short timeout, and if it
   fails, the token request fails, so a token never silently lacks a claim
   the customer relies on.

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
request says `prompt=consent`. The scope descriptions on the screen come from
config, translated with the release.

A user lists and revokes their consents through me endpoints, which use the
session cookie like the other me endpoints (ADR 036); the connected-apps
component calls them. Revoking a consent revokes the app's refresh tokens for
that user.

### 9. Registration

- **First release:** apps are registered statically, through the API, the
  Console or the CLI, first- and third-party alike.
- **Next release:** client ID metadata documents. A client uses an HTTPS URL as
  its `client_id`, and the server fetches and validates the JSON document
  behind it when an authorization request names it: HTTPS only, no private or
  special-use addresses, limits on size and time, and caching. Such clients
  are third-party.
- **With it, for compatibility:** dynamic client registration (RFC 7591), for
  clients that register no other way.
- Both are **off by default** in each project, because open registration is an
  abuse surface (ADR 078); a project turns them on in config. A client
  registered either way belongs to the issuer's project, which answers #375's
  question of how dynamically registered clients map to projects.

### 10. MCP

With §5 and §9, any MCP client can use an MCP server that a customer's app
hosts. The client finds the issuer in the protected-resource metadata the SDK
serves and the endpoints under ADR 080's reserved paths, registers with a
client ID metadata document, and gets a token for the MCP server's URI with
PKCE and `resource`. MCP's enterprise-managed authorization builds on token
exchange and comes with it (§11).

### 11. Later

Device authorization (RFC 8628) for CLIs and TVs, token exchange (RFC 8693)
for delegation and agents, back-channel logout, pushed authorization requests
(RFC 9126), DPoP (RFC 9449), and the user's roles and permissions in tokens
([#425](https://github.com/zitadel/nextgen/issues/425)).

## Recommended sequence

1. This ADR, with ADR 080.
2. The first release, with ADR 080's steps 3 and 5: web, SPA and native apps,
   first- and third-party, registered statically; the standard scopes and the
   claim mapping; the code flow with PKCE and refresh rotation; discovery,
   JWKS, userinfo and end session; consent, its me endpoints and the
   connected-apps component.
3. Protected APIs: resource indicators, per-API scopes and lifetimes, claim
   rules, refresh token revocation, and the SDK's verification and
   protected-resource metadata.
4. Client ID metadata documents and dynamic registration. MCP clients work
   from here.
5. Service apps: client credentials and `private_key_jwt`.
6. The claims hook.

## Consequences

### Positive

- Each part has one owner, and customers shape scopes and claims without
  writing protocol code.
- OAuth 2.1 from the start leaves no weak grant to retire later.
- MCP clients work against a customer's app after step 4, without the custom
  auth proxies #375 describes.
- Claims are decided where tokens are signed, so a user cannot forge them.

### Negative / Risks

- Relying parties on the implicit flow or the password grant must move to the
  code flow with PKCE first.
- The claims hook puts the customer's backend on the token path: a slow or
  failing hook fails sign-ins and refreshes.
- Without introspection, an access token stays valid until it expires, five
  minutes by default (ADR 037), even after its consent is revoked.
- Claim rules ship with a release, and a refresh token keeps the deployment
  it was sealed with (ADR 080 open question 10), so a rule change reaches
  existing sign-ins only when their refresh tokens end.
- Client ID metadata documents make the server fetch URLs that clients
  choose; the guards in §9 must hold.
- A client that calls two APIs keeps two access tokens.

## Open questions

1. Whether a hook may fail open, per hook, for claims nothing depends on.
2. Whether userinfo calls the claims hook too, or answers only standard and
   rule claims.
3. Pairwise subject identifiers for third-party apps, so they cannot correlate
   users by `sub`.
4. Which lifetime wins when an app and an API both set one.
5. Which sources besides the user's schema properties claim rules may read:
   teams, the project, the app.
6. Whether the connected-apps component is its own element or part of
   `<zitadel-session>`, and its name.

## Rejected alternatives

- **A separate `<zitadel-oidc-server>` component for the OIDC pages.** Consent
  would sit on a page the customer builds, which could leave it out, and two
  elements would share one flow's state. One orchestrator keeps consent a step
  no page can drop (ADR 080 §11).
- **Claims decided by a web component.** The user controls the browser.
- **Only rules, or only a hook.** Rules cannot reach data outside Zitadel; a
  hook alone makes every customer run a service for what a rule could add.
- **Implicit, hybrid or password grants for older relying parties.** OAuth 2.1
  drops them: they put tokens in URLs or hand passwords to clients.
- **Several audiences per access token.** Each API could replay a token at the
  others.
- **Dynamic registration on by default.** Anyone could create clients in a
  project (ADR 078).
- **Calling consents grants.** ADR 032's grants are permissions.

## Non-goals

- SAML and SCIM.
- Roles and permissions in tokens (#425), and organizations inside a project.
- Agent identity beyond token exchange (#375).
- OpenID certification and the FAPI profiles.

## Documentation impact

On acceptance:

- the [glossary](../design/glossary.md): *app* gains its kinds and first- and
  third-party, and *consent*, *protected API* and *claims hook* get rows;
- the [configuration surface](../design/platform/configuration-surface.md):
  protected APIs, scopes, the claim mapping, claim rules, the hook and the
  registration switches;
- the [resource map](../design/api/resource-map.md): the app resource and the
  consent me endpoints;
- the [auth flows design](../design/api/authn-and-auth-flows.md): Path 3 gains
  client credentials and the consent step.

On implementation: the API spec, the CLI's
[`SKILL.md`](../../apps/cli/skills/zitadel-cli/SKILL.md), the SDK READMEs and
the components README.
