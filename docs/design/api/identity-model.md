# Identity Model: Users, Apps and Connections

> **Status:** Draft for discussion. The names are proposals too; see
> [Names](#names).
> **Date:** 2026-10-28
> **Builds on:** [#1425](https://github.com/zitadel/nextgen/issues/1425)
> (Application and Client),
> [#2430](https://github.com/zitadel/nextgen/pull/2430) (apps, machine
> identities and client credentials),
> [ADR 082](../../adrs/082-oauth-and-oidc-server.md),
> [IdP connections](../idp/1-resource-model.md)
> **Reopens:** the 26 Oct agreement that user schemas describe every identity
> type, machines included

## Goal

A developer, or an agent working for one, meets Zitadel's nouns before
anything else. Three should be enough, named the way the rest of the market
names them, and each thing a developer wants to do should be one object, or
one config on one.

Zitadel sits between two sides. On one side are the parties that rely on it:
apps that sign users in with it, call APIs with its tokens, or receive users
from it. On the other are the parties it relies on: the providers users sign
in with, the directories that provision them, the CI systems that vouch for
workloads. The model gives each side one noun, and each holds a config per
protocol it speaks.

The v4 lesson points the same way. A backend that serves an API and calls
other APIs ended up as two apps and a machine user, each with its own
credential, and only the machine user could hold permissions.

## The model

| Noun | Is | Holds |
| --- | --- | --- |
| **User** | A person who signs in | Properties and sign-in methods, defined by a user schema per kind of person |
| **App** | Anything that uses Zitadel: a web or mobile app, a backend, an agent, a service account, a SaaS product | Any number of configs: OAuth and OIDC clients, SAML IdP configs, SCIM configs and APIs, each with its mappings |
| **Connection** | Anything Zitadel trusts upstream: Google, a customer's Entra, GitHub Actions, a SCIM directory | Any number of configs: OIDC and OAuth RP, OIDC WIF, SAML SP and SCIM provider configs, with the mappings |

The two sides mirror each other:

| | App (Zitadel is the authority) | Connection (Zitadel trusts it) |
| --- | --- | --- |
| OIDC and OAuth | Clients: Zitadel is the provider | RP configs: Zitadel signs users in upstream |
| Workloads | A client is the principal a workload acts as | OIDC WIF: Zitadel accepts a workload's token |
| SAML | IdP configs: Zitadel signs users into the app | SP configs: Zitadel trusts the upstream IdP |
| SCIM | Zitadel provisions users into the app | The upstream provisions users into Zitadel |
| Mappings | User properties to claims, attributes and SCIM | Claims, attributes and SCIM to user properties, or a workload to a client |
| Principals | A client can be one | None of its own |

Every config type has a published JSON Schema, as the IdP connection has
today, so a file, the API and the CLI share one shape, and an agent validates
a config before it deploys it.

### Users

- A user is a person. Machines are not users: software is an app.
- User schemas keep their role: they define the kinds of people, their
  properties, and how each kind signs in.
- Personal access tokens stay on users, for scripting as yourself. A token
  acts with its user's permissions and ends with the user.

### Apps

An app is one piece of software, and it holds as many configs as it needs:

- **Clients**, OAuth or OIDC, any number: a web client, a mobile client, a
  backend, a deploy job. Each has its own type, credentials, grants and
  redirect URIs.
- **SAML IdP configs**, for a service provider that signs its users in
  through SAML.
- **SCIM configs**, for an app Zitadel provisions users into.
- **APIs** the app serves: an identifier, which is the `aud` of tokens for
  it, and scopes. A token is for one API
  ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)).
- **Dynamic registration**, when the app opens it: agents that register
  ([RFC 7591](https://www.rfc-editor.org/rfc/rfc7591), or a
  [client ID metadata document](https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/))
  become third-party clients of the app.

**A client can be a principal.** A client that authenticates as itself, with
a key, a secret or a WIF mapping, gets tokens whose `sub` is the client, and
it holds rights the way a user does:

- **Its own permissions**, for the calls it makes as itself.
- **Delegate**: get a token for a user it acts for, through token exchange
  ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)). The token's `sub` is
  the user and its `act` names the client, so every API sees both. A
  third-party client delegates only for users who consented.
- **Impersonate**: the same, without `act`, so APIs see only the user. It is
  the narrower right, for support tooling, and the server audits every
  exchange.

Rights are granted like any other permission, so they can be scoped (all
users, users of one schema, one team) and are audited the same way. A public
client, such as a SPA or a mobile app, is never a principal: it only acts for
the user who signed in.

That covers machines without machine users:

- A **service account** is an app whose client is a principal.
- An **agent** is an app whose client is a principal with the right to
  delegate. A third-party agent, such as an MCP client, is a client that
  registered into the app whose API it uses, acting for the user who
  consented.
- A **backend that serves an API and calls others** is one app, with an API
  and a client, not v4's two apps and a machine user.

### Connections

A connection is one upstream party, and it holds as many configs as it
needs, with the mappings between them:

- **OIDC and OAuth RP configs**, any number: Zitadel signs users in at the
  upstream provider.
- **OIDC WIF configs**: Zitadel accepts the tokens that CI systems, clusters
  and clouds issue to their workloads, so a workload needs no secret.
- **SAML SP configs**: Zitadel signs users in at an upstream SAML IdP.
- **SCIM provider configs**: the upstream provisions users and groups into
  Zitadel.

The mappings say:

- how upstream claims, attributes and SCIM resources become user properties,
  and when a user is created on first sign-in;
- where each config finds the shared subject, so a user that SCIM created
  signs in through OIDC without a linking step;
- which client a workload token becomes, by its claims (for GitHub Actions,
  the repository and the branch).

## How it looks

Sketches of the shape, not schemas.

An app with four clients, an API, a SAML config, a SCIM target and open
registration:

```json
{
  "name": "Shop",
  "clients": [
    { "slug": "web", "protocol": "oidc", "type": "confidential", "redirect_uris": ["https://shop.example.com/callback"] },
    { "slug": "ios", "protocol": "oidc", "type": "public", "redirect_uris": ["com.example.shop:/callback"] },
    { "slug": "deploy", "protocol": "oauth", "grants": ["client_credentials"], "principal": { "roles": ["releases.write"] } },
    {
      "slug": "assistant",
      "protocol": "oauth",
      "grants": ["client_credentials", "token_exchange"],
      "principal": { "roles": ["catalog.read"], "delegate": { "apis": ["orders"] } }
    }
  ],
  "apis": [{ "slug": "orders", "identifier": "https://api.shop.example.com", "scopes": ["orders.read", "orders.write"] }],
  "saml": [{ "slug": "partners", "entity_id": "https://partners.shop.example.com", "acs_url": "https://partners.shop.example.com/saml/acs" }],
  "scim": [{ "slug": "crm", "endpoint": "https://crm.example.com/scim/v2", "token": "${{ CRM_SCIM_TOKEN }}" }],
  "registration": { "dynamic": true }
}
```

A customer's Entra, signing users in and provisioning them under one subject:

```json
{
  "name": "Acme",
  "oidc": [{ "slug": "entra", "issuer": "https://login.microsoftonline.com/<tenant>/v2.0", "client_id": "<id>", "client_secret": "${{ ACME_ENTRA_SECRET }}" }],
  "scim": [{ "slug": "entra-sync" }],
  "mappings": {
    "subject": { "entra": "oid", "entra-sync": "externalId" },
    "user": { "email": "email", "givenName": "given_name", "familyName": "family_name" }
  }
}
```

GitHub Actions, deploying as the shop's `deploy` client without a secret:

```json
{
  "name": "GitHub Actions",
  "oidc_wif": [{ "slug": "actions", "issuer": "https://token.actions.githubusercontent.com", "audience": "https://auth.shop.example.com" }],
  "mappings": {
    "clients": [{ "when": { "repository": "acme/shop", "ref": "refs/heads/main" }, "client": "shop/deploy" }]
  }
}
```

## Names

| Name | Means | Instead of | Why |
| --- | --- | --- | --- |
| **User** | A person who signs in | "human user", "identity" | Everyone's word |
| **App** | Anything that uses Zitadel, agents and service accounts included | v4's project, app and machine user; the glossary's `app_group` | Auth0, Okta, Entra and GitHub all say app |
| **Client** | An OAuth or OIDC config of an app; can be a principal | the glossary's `app`, ADR 082's app kinds | The protocol's word, which developers and agents already know |
| **API** | What an app serves: an identifier and scopes | "resource server", v4's API app | Auth0's word |
| **Connection** | Anything Zitadel trusts upstream, with its configs and mappings | "IdP", "provider", v4's identity providers | Auth0's and WorkOS's word. "Provider" already names Zitadel itself, the OIDC provider, and the server side of SCIM |
| **WIF config** | A connection's trust in the tokens workloads get from CI systems, clusters and clouds | keys and secrets stored in CI | The clouds' name: workload identity federation |
| **Mapping** | How claims, attributes and SCIM translate to and from user properties, and which client a workload becomes | the IdP connection's `claim_mapping`, v4's actions for mapping | Says what it does |
| **Delegate**, **impersonate** | Rights a principal client holds to act for a user, with `act` or without | v4's impersonation setting | RFC 8693's words |

## What changes

Measured against what the repo has today:

| Area | Today | With this model |
| --- | --- | --- |
| Glossary | `app` is one OIDC client or SAML SP; `app_group` (LOCKED) holds roles; `idp` is an upstream provider | `app` is the software and holds its configs; one OIDC client is a client; `idp` becomes connection |
| Authz | Principal types `user`, `team`, `agent`, `sk_proj`, `sk_team`; `agent` is unused | A `client` principal type, which `agent` becomes; delegate and impersonate as rights |
| #2430 | Machines are users of a `service` or `agent` kind; a client is owned by an app, an identity or both; client methods sit in `x-auth-methods` | Machines are apps; every client belongs to an app and can be a principal itself; client methods move to the client, and `x-auth-methods` keeps sign-in methods. Its secret format, hashing and PAT design carry over; its client table loses the identity column |
| IdP connections | Project-level, OIDC only, one `protocol` block per connection | A connection holds several configs (OIDC, OAuth, WIF, SAML, SCIM) and the mappings between them |
| ADR 082 | `Service` app kind; APIs are separate files; registered clients belong to the project; token exchange later | Any confidential client can be a principal; APIs are an app's config, still one audience per token; registered clients join an app; token exchange moves up for delegation, impersonation and WIF |
| v4 import | — | v4 projects become apps; v4 apps become clients, SAML configs or APIs; v4 machine users become apps with a principal client |

Clients become a sub-resource of their app, so a declared app and the clients
registered into it keep separate writers. Tokens stay single-audience, and
consents stay per user, client and scope.

## Open questions

1. **Names.** App or Application; Connection or Provider; what to call the
   configs.
2. **Rights on the app.** Whether a right granted to an app reaches all its
   principal clients, for convenience, or rights stay per client.
3. **Delegation and impersonation policy.** Who may grant them, over which
   users, and when a user's consent is needed.
4. **Registration.** A dynamic registration request names no API, so how it
   finds its app: a registration endpoint per app, or the app of the API in
   the first authorization request.
5. **Connection scope.** Project-level, or owned by a team, so a B2B customer
   brings its own Entra.
6. **Identity links.** Whether a link keys on the connection or on one of its
   configs, when a connection holds two OIDC configs for different issuers.
7. **Where sign-in offers connections.** Today a user schema lists its
   connections (`x-auth-methods.sso.providers`); with several configs per
   connection, the list may name configs, or the app may choose.

## Prior art

- **Auth0**: machine-to-machine applications are principals (`sub` is
  `<client_id>@clients`); an application can carry a SAML add-on beside its
  OAuth settings; connections.
- **Okta**: app integrations that carry sign-on and provisioning together.
- **Google Cloud**: workload identity pools hold several providers with
  attribute mappings and conditions, which is the shape of a connection with
  WIF configs.
- **Microsoft Entra**: federated credentials on an app registration, and the
  on-behalf-of flow for delegation.
- **Zitadel v4**: token exchange with impersonation, which a security setting
  has to allow.
- **Keycloak**, as a warning: a client with service accounts enabled gets a
  hidden user that holds its roles. Here the client is the principal.
