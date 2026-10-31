# Identity Model: Users, Apps and Connections

> **Status:** Draft for discussion. The names are proposals too; see
> [Names](#names).
>
> **Date:** 2026-10-28
>
> **Builds on:** [#1425](https://github.com/zitadel/nextgen/issues/1425)
> (Application and Client),
> [#2430](https://github.com/zitadel/nextgen/pull/2430) (apps, machine
> identities and client credentials),
> [ADR 082](../../adrs/082-oauth-and-oidc-server.md),
> [IdP connections](../idp/1-resource-model.md)
>
> **Reopens:** the 26 Oct agreement that user schemas describe every identity
> type, machines included

## Goal

A developer, or an agent working for one, meets Zitadel's nouns before
anything else. Three should be enough, named the way the rest of the market
names them, and each thing a developer wants to do should be one object, or
one config on one, written in one call.

Zitadel sits between two sides. On one side are the parties that rely on it:
apps that sign users in with it, call APIs with its tokens, or receive users
from it. On the other are the parties it relies on: the providers users sign
in with, the directories that provision them, the CI systems that vouch for
workloads. The model gives each side one noun, and each holds a config per
protocol it speaks.

The v4 lessons point the same way. A backend that serves an API and calls
other APIs ended up as two apps and a machine user, each with its own
credential, and only the machine user could hold permissions. And every app
took a project first, then the app in it, then its roles and keys, each a
call that needed the id the last one returned ([One call](#one-call)).

## The model

| Noun | Is | Holds |
| --- | --- | --- |
| **User** | A person who signs in | Properties and sign-in methods, defined by a user schema per kind of person |
| **App** | Anything that uses Zitadel: a web or mobile app, a backend, a service account, a SaaS product, or an agent calling APIs and MCP servers, Zitadel's own included | Any number of configs: OAuth and OIDC clients, SAML IdP configs, SCIM provisioning configs, and the APIs it serves, MCP servers among them, each with its mappings. A confidential client can be a principal: it acts as itself, or for a user by delegation or impersonation |
| **Connection** | Anything Zitadel trusts upstream: Google, a customer's Entra and the agents it runs, GitHub Actions, a SCIM directory | Any number of configs: OIDC and OAuth RP, OIDC WIF, SAML SP and SCIM provider configs, with the mappings |

The two sides mirror each other:

| | App (Zitadel is the authority) | Connection (Zitadel trusts it) |
| --- | --- | --- |
| OIDC and OAuth | Clients: Zitadel is the provider | RP configs: Zitadel signs users in upstream |
| Workloads | A client is the principal a workload acts as | OIDC WIF: Zitadel accepts a workload's token |
| Agents | The customer's own agents, and third parties that registered | External agents, which a trusted party runs and vouches for; the mapping says which client each becomes |
| SAML | IdP configs: Zitadel signs users into the app | SP configs: Zitadel trusts the upstream IdP |
| SCIM | Provisioning configs: Zitadel is the SCIM client and pushes users into the app | Provider configs: Zitadel is the SCIM server, and the upstream pushes users in |
| Mappings | User properties to claims, attributes and SCIM | Claims, attributes and SCIM to user properties, or a workload to a client |
| Principals | A client can be one | None of its own |

Every config type has a published JSON Schema, as the IdP connection has
today, so a file, the API and the CLI share one shape, and an agent validates
a config before it deploys it.

### Users

- A user is a person. Machines are not users: software is an app.
- User schemas keep their role: they define the kinds of people, their
  properties, and how each kind signs in.
- A user is a principal: it holds grants, joins teams and owns personal
  access tokens, as a principal client does ([Principals](#principals)).

### Apps

An app is one piece of software, and it holds as many configs as it needs:

- **Clients**, OAuth or OIDC, any number: a web client, a mobile client, a
  backend, a deploy job. Each has its own type, credentials, grants and
  redirect URIs.
- **SAML IdP configs**, for a service provider that signs its users in
  through SAML.
- **SCIM provisioning configs**, for an app with its own user store: Zitadel
  is the SCIM client and keeps the app's users in step, creating, updating
  and deactivating them.
- **APIs** the app serves, MCP servers among them: an identifier, which is
  the `aud` of tokens for it, and scopes. A token is for one API
  ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)). The API also names
  the clients that may introspect its tokens
  ([RFC 7662](https://www.rfc-editor.org/rfc/rfc7662)), as
  `introspection.clients` did in
  [#2430](https://github.com/zitadel/nextgen/pull/2430), and they
  authenticate as they do at the token endpoint.
- **Dynamic registration**, when the app opens it: agents that register
  themselves, the ways
  [ADR 082 §9](../../adrs/082-oauth-and-oidc-server.md#9-registration)
  allows, become third-party clients of the app. They register at the
  project, since an endpoint per app would need an issuer per app, and join
  the app whose API their first authorization request names as `resource`,
  which MCP requires. A later request for another app's API is refused.

**A client can be a principal.** A client that authenticates as itself, with
a key, a secret or a WIF mapping, gets tokens whose `sub` is the client, and
it holds rights the way a user does ([Principals](#principals)):

- **Its own roles**, for the calls it makes as itself.
- **Delegate**: get a token for a user it acts for, through token exchange
  ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)). The token's `sub` is
  the user and its `act` names the client, so every API sees both. A
  third-party client delegates only for users who consented.
- **Impersonate**: the same, without `act`, so APIs see only the user. It is
  the narrower right.

A public client, such as a SPA or a mobile app, is never a principal: it only
acts for the user who signed in.

That covers machines without machine users:

- A **service account** is an app whose client is a principal.
- A **backend that serves an API and calls others** is one app, with an API
  and a client, not v4's two apps and a machine user.

**An agent is an app too**, whoever built it. How it gets tokens depends on
whom it works for, whose API it calls, and who vouches for it:

- **For itself**, such as a job that reprices the catalog every night: its
  client is a principal with its own permissions, and authenticates with a
  key, or through WIF with no stored secret.
- **For a user**: the user signs in and consents to the agent, or the agent
  exchanges a token it got from the user, with its delegate right. Either
  way the token's `sub` is the user, and the token names the agent too, as
  its `client_id` and, after an exchange, in `act`.
- **As a third party**, such as Claude or ChatGPT calling an app's MCP
  server: it registers into that app and acts for the users who consent. It
  holds no rights of its own until the project grants them.
- **On Zitadel itself**, through Zitadel's API or MCP server: Zitadel's own
  project, the platform project, is a project like any other, so its API is
  one more API and the same rules apply. The agent acts for the developer
  who connected it, or holds permissions of its own.
- **External**, when a party Zitadel trusts vouches for it, such as an agent
  that runs in a customer's Entra: it comes in through that party's
  connection, and the mapping says which client it becomes, as for a CI
  workload.

Agents delegate: a delegated token names the agent in `act`, so an API can
set limits for agents, and Zitadel can refuse what only a person may do,
such as claiming a project. Who may impersonate is the customer's call, for
its staff or its tools.

### Connections

A connection is one upstream party, and it holds as many configs as it
needs, with the mappings between them:

- **OIDC and OAuth RP configs**, any number: Zitadel signs users in at the
  upstream provider.
- **OIDC WIF configs**: Zitadel accepts the tokens that CI systems, clusters,
  clouds and agent platforms issue to their workloads and agents, so neither
  needs a secret.
- **SAML SP configs**: Zitadel signs users in at an upstream SAML IdP.
- **SCIM provider configs**: the upstream provisions users and groups into
  Zitadel.

The mappings say:

- how upstream claims, attributes and SCIM resources become user properties,
  and when a user is created on first sign-in;
- where each config finds the shared subject, so a user that SCIM created
  signs in through OIDC without a linking step;
- which client a workload or an external agent becomes, by the claims in its
  token (for GitHub Actions, the repository and the branch).

### Principals

A principal is what a token acts as: a user, a principal client, a team, or
the project itself through its secret. A public client never is one.

**Grants give principals roles**, directly or through a team:

- **On an app.** Which users may use an app, and with which of its roles, is
  a grant on the app, as v4 had them on projects. A principal client is
  granted the same way, so one service calling another is a grant of client
  A on app B. Zitadel's own permissions, such as deploying a release, are
  granted on the project, as they are to a user.
- **Per client.** The deploy client may ship a release, the assistant reads
  the catalog and delegates, and the web client holds nothing of its own. A
  grant to a whole app would at most be a console shortcut.
- **Through a team.** A client joins a team as a user does, so an agent on a
  team is a client in it. `team_memberships` is keyed by `user_id` in all
  three dialects today, so it gains a principal type.
- **From the release or the API.** The developer's grants for its own clients
  ship in the release with its apps, so the deploy that adds a client gives it
  its rights. Grants to users and to teams are data, written through the API.

**Delegate and impersonate are roles like any other.** Users and clients hold
them, directly or through a team, over one user, a schema's users or a team's
users, as v4's `ORG_END_USER_IMPERSONATOR` was. What they need on top:

- a switch on the project or the app before impersonation can be granted at
  all, as v4's security setting was;
- an audit of every exchange, naming the holder, the user acted for and the
  path the right came from: directly, or through which team;
- the effective holders in the console, so "who can impersonate Acme's
  users" lists those who hold it through a team too.

**Personal access tokens belong to a principal**, never to the person who
minted one. A tool that takes nothing but a static bearer token, such as a
Grafana data source, a CI plugin or a webhook sender, then needs no person's
token, which breaks when that person leaves.

- A PAT acts with its owner's rights and ends with its owner.
- Whoever may manage the owner manages its PATs: creates, lists, rotates and
  revokes them. The creator is kept for audit only.
- The project's and a team's secrets, `sk_proj` and `sk_team`
  ([`security.go`](../../../internal/api/security.go)), become PATs that the
  project and the team own: one token kind with an owner type, one hash, one
  verify path, and a prefix per owner type, so secret scanners tell the kinds
  apart.

**A client's scopes are its ceiling.** A CLI is a public client that asks for
scopes for the user who signed in, and a PAT is capped by its owner's rights
and the scopes it was minted with, so no layer goes on top. Today scopes cap
only project secrets (`project.read`, `project.write`) and a session token
carries no scope, so the ceiling holds once checks intersect a user's roles
with the token's scopes, which [authz](authz.md) leaves to
[#420](https://github.com/zitadel/nextgen/issues/420).

## How it looks

Sketches of the shape, not schemas. The app and GitHub Actions are the
developer's, as code; Acme's Entra is data that Acme's admin writes
([Code or API](#code-or-api)).

An app with four clients, an API and an MCP server, a SAML config, SCIM
provisioning and open registration:

```json
{
  "name": "Shop",
  "slug": "shop",
  "clients": [
    { "slug": "web", "protocol": "oidc", "type": "confidential", "redirect_uris": ["https://shop.example.com/callback"] },
    { "slug": "ios", "protocol": "oidc", "type": "public", "redirect_uris": ["com.example.shop:/callback"] },
    { "slug": "deploy", "protocol": "oauth", "grant_types": ["client_credentials"] },
    { "slug": "assistant", "protocol": "oauth", "grant_types": ["client_credentials", "token_exchange"] }
  ],
  "apis": [
    { "slug": "orders", "identifier": "https://api.shop.example.com", "scopes": ["orders.read", "orders.write"] },
    { "slug": "mcp", "identifier": "https://shop.example.com/mcp", "scopes": ["orders.read"] }
  ],
  "saml": [{ "slug": "partners", "entity_id": "https://partners.shop.example.com", "acs_url": "https://partners.shop.example.com/saml/acs" }],
  "scim": [{ "slug": "crm", "endpoint": "https://crm.example.com/scim/v2", "token": "${{ CRM_SCIM_TOKEN }}" }],
  "registration": { "dynamic": true }
}
```

`grant_types` keeps RFC 7591's name, since here a grant is what gives a
principal roles. Those rights are not fields of the document: grants that ship
beside it let `deploy` release and let `assistant` read the catalog and
delegate for the shop's customers ([Principals](#principals)).

A customer's Entra, which Acme's admin sets up in the product, signing users
in and provisioning them under one subject:

```json
{
  "team": "acme",
  "slug": "entra",
  "domains": ["acme.com"],
  "oidc": [{ "slug": "sign-in", "issuer": "https://login.microsoftonline.com/<tenant>/v2.0", "client_id": "<id>", "client_secret": "<write-only>" }],
  "scim": [{ "slug": "sync" }],
  "mappings": {
    "subject": { "sign-in": "oid", "sync": "externalId" },
    "user": { "email": "email", "givenName": "given_name", "familyName": "family_name" }
  }
}
```

The developer's rules decided what it may hold, and the Entra preset filled
its mappings.

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

## One call

Each app and each connection is one document, and one call writes it:

- **An app with every config it holds** is the body of `POST /apps`, which
  creates the app or revises it by slug
  ([ADR 082 §3](../../adrs/082-oauth-and-oidc-server.md#3-apps)). No
  container comes first, as v4's project did, and a client, an API or a SAML
  config is a field of the document, not a call of its own. Only clients that
  register themselves arrive on their own.
- **A connection with its configs and mappings** is one document too, so
  Acme's Entra above signs users in and provisions them from one write.
- **Documents name each other by slug**, as the GitHub Actions connection
  names `shop/deploy`, so no call waits for an id that another returned.
- **A release ships them together.** Declared apps and connections are files
  in `.zitadel/`, and one `POST /releases/build` creates or revises them all
  in one transaction
  ([ADR 035](../../adrs/035-configuration-environments.md)), as it does for
  connections today: a project's setup lands whole or not at all.
- **The answer says what comes next**: each client's id, the issuer, and a
  registered client's secret, shown once.
- **Credentials have calls of their own.** A client's secrets and keys, and
  every PAT, are added, rotated and revoked outside the document, which at
  most names them, so a rotation never revises the app.

**The console filters instead of adding nouns.** Apps hold many kinds of
configs, so the console gives the common ones lists of their own: apps with
a principal client, apps that delegate, APIs and MCP servers, SAML and SCIM
configs, third parties that registered. Each list is a filter over apps, in
the grammar the API and the CLI share
([ADR 064 §11](../../adrs/064-cli-resource-commands.md#11-one-filter-grammar-whatever-the-transport)),
so an agent finds the same apps, and every config is edited in the app that
holds it.

**The CLI makes the common case one command:**

```bash
zitadel app create shop --preset web --redirect-uri https://shop.example.com/callback
zitadel app create repricer --preset service-account --role catalog.write
```

- A preset fills the document for a common shape: a web app, a SPA, a mobile
  app, a backend with an API, a service account, an agent. Nobody picks grant
  types or authentication methods, and `--file` takes a whole document
  instead. The presets ship beside the JSON Schemas, so the console offers
  the same ones and an agent can start from them.
- A command writes every file its task needs. `app create` turns the
  project's issuer on in `.zitadel/oauth.json` when it is off
  ([ADR 081 §7](../../adrs/081-customer-hosted-login-and-oidc-provider.md#7-what-the-scaffold-reserves)),
  and says so: no project step comes first. `auth-method sso enable` already
  writes a whole connection this way.
- It asks only for what it cannot default, such as a redirect URI, and its
  `--json` envelope carries the client ids, the issuer and the
  `next_commands`.

## Code or API

The release suits what the developer owns, and not what its customers own. A
B2B customer's Entra is set up by that customer's admin, in the product, long
after the release that shipped the product, so no repository can hold it.
Each resource takes one path, chosen by its owner, and the document and its
one call are the same on both
([ADR 082 §1](../../adrs/082-oauth-and-oidc-server.md#1-who-owns-what)).
[ADR 064 §1](../../adrs/064-cli-resource-commands.md#1-configuration-stays-declarative-runtime-resources-become-imperative)
left customer-owned connections to be decided on their merits; this is that
decision.

| | As code, in the release | Through the API |
| --- | --- | --- |
| Apps | The developer's own: web and mobile apps, backends, service accounts, agents | Apps the product creates for its customers, and third parties that registered |
| Connections | The developer's own: social providers, the company's IdP, its CI | Each B2B customer's SSO and SCIM, which the customer's admin sets up |
| Grants | The developer's own clients' rights | Users' and teams' roles, and the rights a customer gives its own staff and tools |
| Self-service rules | What a customer may set up, and what it must map | — |

**Self-service splits in two.** The developer declares the rules once, as
code, and each customer's admin writes a connection within them:

- **The rules**: the protocols a customer may add, the user schema its users
  get and the properties they must have, the roles they start with, and
  whether a domain must be verified first. One deploy changes them for every
  customer.
- **The customer's connection**: its issuer or metadata, its credentials, its
  domains, and how its claims fill the properties the rules ask for. A preset
  per provider, such as Entra, Okta or Google Workspace, fills the mapping, as
  a preset fills an app.

**What keeps it safe**, since a customer writes it:

- A team's connection serves its team only. The users it creates are
  team-owned, as [hierarchy](hierarchy.md) has it for tenant-managed sources,
  and it signs in or links only that team's users, so no customer can claim
  another's email addresses and take over those accounts.
- It answers only for domains the customer verified, which is also how
  sign-in finds it: a schema is code, and cannot list a connection made after
  the release.
- Its slug is the team's, `acme/entra`, as a client's is its app's, so a
  declared connection can never revise a customer's by sharing its slug.
- A secret the customer's admin enters is write-only and stored encrypted
  ([ADR 029](../../adrs/029-cryptography-secrets-and-key-lifecycle.md)); for
  a SCIM config, Zitadel mints the token and shows it once.
- `team_admin` gets the right to manage its team's connections, which only
  `project_admin` holds today
  ([permission catalog](system-permission-catalog.md)), and the setup screen
  calls the API with that admin's own session.

**The developer builds no setup screen.** A product with a screen of its own
calls the API; any other embeds an element in its admin page, as it embeds
the login and ADR 082's connected-apps element. The element shows the
customer's admin the redirect URI or ACS URL to register upstream, takes the
metadata, verifies the domain, checks the mapping and runs a test sign-in.

**What code cannot do, and how the model copes:**

- **A deploy touches only what it declares.** It never revises or removes a
  customer's connection or a registered app. A connection the developer
  manages for a customer, through the API or a Terraform provider, is
  read-only in that customer's setup screen, so every connection has one
  writer.
- **A customer's connection may name code, never the reverse.** It names the
  user schema whose properties it fills, and a release that removes or
  renames a property still in use fails its build, naming the connections.
- **Code is the same in every project it ships to; data is not.** Staging
  gets the apps and the rules from the release, but not the customers'
  connections, so it tests the rules with connections of its own.
- **A rule change reaches every customer with the next deploy**, which is why
  the rules are code. A connection the change leaves short, such as one that
  maps no property the rules now require, says so to its admin.

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
| **Delegate**, **impersonate** | Roles to act for a user, with `act` or without, which users and clients hold | v4's impersonation setting | RFC 8693's words |

## What changes

Measured against what the repo has today:

| Area | Today | With this model |
| --- | --- | --- |
| Glossary | `app` is one OIDC client or SAML SP; `app_group` (LOCKED) holds roles; `idp` is an upstream provider | `app` is the software and holds its configs; one OIDC client is a client; `idp` becomes connection |
| Authz | Principal types `user`, `team`, `agent`, `sk_proj`, `sk_team`; `agent` is unused; team members are users; scopes cap only project secrets; only `project_admin` writes connections | A `client` principal type, which `agent` becomes, with grants and team memberships like a user's; delegate and impersonate as roles; `sk_proj` and `sk_team` become PATs with an owner type; a client's scopes cap every token; `team_admin` manages its team's connections |
| #2430 | Machines are users of a `service` or `agent` kind; a client is owned by an app, an identity or both; client methods sit in `x-auth-methods` | Machines are apps; every client belongs to an app and can be a principal itself; client methods move to the client, and `x-auth-methods` keeps sign-in methods. Its secret format, hashing, import rules and named credentials per client carry over, and its PATs gain an owner type; its client table loses the identity column |
| IdP connections | Project-level, OIDC only, one `protocol` block per connection | A connection holds several configs (OIDC, OAuth, WIF, SAML, SCIM) and the mappings between them; the developer's are declared, and a B2B customer's belongs to its team and is written through the API within the developer's rules |
| ADR 082 | `Service` app kind; APIs are separate files; registered clients belong to the project; token exchange later; no introspection | Any confidential client can be a principal; APIs are an app's config, still one audience per token; registered clients register at the project and join the app whose API they first ask for; token exchange moves up for delegation, impersonation and WIF; an API names the clients that may introspect its tokens |
| CLI | ADR 082 §12: `oauth enable`, `apps create` and `apis create`, each writing a file | `app create` writes an app with its clients and APIs from a preset, and turns the issuer on if it is off |
| v4 import | — | v4 projects become apps; v4 apps become clients, SAML configs or APIs, and keep their client ids (`<id>@<project>`); a v4 machine user becomes an app with a principal client, whose id is the v4 user id that APIs stored as `sub`, or which carries that id as a legacy subject; its PATs move onto that client |

Clients become a sub-resource of their app, so a declared app and the clients
registered into it keep separate writers. Tokens stay single-audience, and
consents stay per user, client and scope.

## Open questions

1. **Names.** App or Application; Connection or Provider; what to call the
   configs, and a PAT that a client or a team owns.
2. **Rights on the app.** Answered: rights stay per client, and a grant to a
   whole app would at most be a console shortcut ([Principals](#principals)).
3. **Delegation and impersonation policy.** Partly answered: they are roles,
   held directly or through a team, over a user, a schema's users or a
   team's users ([Principals](#principals)). Still open: whether the switch
   that allows impersonation sits on the project or the app, when a user's
   consent is needed, and which actions besides claiming a project only a
   person may take.
4. **Registration.** Answered: a client registers at the project and joins
   the app whose API its first authorization request names ([Apps](#apps)).
5. **Self-service rules.** Where they live: on the user schema, which already
   says how a kind of person signs in; as an operation policy on a team's
   connection writes, a template Zitadel defines and the release fills in
   ([ADR 066](../../adrs/066-operation-policies.md)); or in a file of their
   own. And whether a team may use a declared connection too, such as one
   Okta for several teams.
6. **Identity links.** Whether a link keys on the connection or on one of its
   configs, when a connection holds two OIDC configs for different issuers.
7. **Where sign-in offers connections.** Today a user schema lists its
   connections (`x-auth-methods.sso.providers`); with several configs per
   connection, the list may name configs, or the app may choose. A team's
   connection is data no schema can list, so sign-in finds it by verified
   domain.
8. **Agents that must be users.** Narrowed: an agent on a team is a client in
   it ([Principals](#principals)). Still open: APIs that accept only user
   tokens, and Entra's agent paired one to one with a user account, which a
   connection could map to a user.
9. **Presets.** Which shapes get one. An app does not keep its preset: the
   console lists apps by what they hold (a client that acts as itself or
   delegates, an API, a registered third party), and nothing in the model
   treats an agent differently from a service account, since `act` and a
   non-user principal already mark what only a person may do.

## Prior art

- **Auth0**: machine-to-machine applications are principals (`sub` is
  `<client_id>@clients`); an application can carry a SAML add-on beside its
  OAuth settings; connections.
- **Okta**: app integrations that carry sign-on and provisioning together.
- **Auth0 self-service SSO**: the developer's self-service profile sets the
  providers a customer may use and the user attributes it must provide, and a
  ticket lets the customer's admin create the connection, with SCIM and a
  DNS-verified domain: the developer's rules and the customer's connection.
- **WorkOS Admin Portal**: a hosted page where a customer's IT admin sets up
  SSO and directory sync, and maps directory attributes onto ones the
  developer defined.
- **Google Cloud**: workload identity pools hold several providers with
  attribute mappings and conditions, which is the shape of a connection with
  WIF configs.
- **Microsoft Entra**: federated credentials on an app registration, and the
  on-behalf-of flow for delegation.
- **Microsoft Entra Agent ID**: an agent identity is a service principal made
  from a blueprint, which holds the credentials. It gets tokens as itself, or
  user tokens that name it as the actor, and an optional user account, paired
  one to one, serves systems that accept only users.
- **MCP authorization**: an MCP server is an OAuth protected resource, and
  its clients register themselves, which is an app's API plus its dynamic
  registration.
- **Zitadel v4**: token exchange with impersonation, which a security setting
  has to allow.
- **Grafana**: a service account owns its tokens, so a data source keeps
  working when the person who set it up leaves.
- **GitHub**: each kind of token has its own prefix, such as `ghp_` and
  `ghs_`, so secret scanning tells them apart.
- **Keycloak**, as a warning: a client with service accounts enabled gets a
  hidden user that holds its roles. Here the client is the principal.
- **Auth0's Deploy CLI**, as a warning: code and dashboard edits share a
  tenant, so a deploy deletes what its files lack only when
  `AUTH0_ALLOW_DELETE` is set. Here every resource has one writer, so a
  deploy holds nothing of a customer's to delete.
