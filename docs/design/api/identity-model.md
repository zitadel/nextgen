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
anything else. Each thing they want to do should be one command that creates
one object, under the name the rest of the market uses for it. Agents lean on
those names harder than people do: they learned identity from Auth0, Okta and
Entra docs, and every name of our own is a chance to guess wrong.

The v4 lesson points the same way. A backend that serves an API and calls
other APIs ended up as two apps and a machine user, each with its own
credential, and only the machine user could hold permissions.

## The model

| Noun | What it holds | What a developer asks for |
| --- | --- | --- |
| **User** | A person who signs in. User schemas define the kinds: customer, employee, partner. | "Who is signed in?" |
| **App** | Any software that uses Zitadel: web, SPA, mobile, desktop, CLI, backend, worker, CI job, agent, or a SaaS product that signs its users in with Zitadel. It holds its platforms, the APIs it serves, its machine access, and outbound SAML and SCIM. | "Add sign-in", "protect my API", "let my backend call X", "let agents use my API" |
| **Connection** | An upstream authority Zitadel trusts: Google, a customer's Okta or Entra, a SCIM directory; later CI issuers and a token vault. | "Sign in with Google", "Acme brings their Okta" |
| **Team** | A B2B customer, owning its connections, domains and members. | "Acme's admin sets up SSO" |

Users sign in, apps authenticate, connections vouch.

### Users

- A user is a person. Machines are not users: software that needs an identity
  of its own is an app.
- User schemas keep their role: they define the kinds of people, their
  properties, and how each kind signs in.
- Personal access tokens stay on users, for scripting as yourself. A token
  acts with its user's permissions and ends with the user.

### Apps

An app is the principal for its own calls. A client credentials token's `sub`
is the app, and permissions are granted to apps the way they are granted to
users. There is no service account behind it to create, find or keep in sync.

The unit is one app per thing that needs its own identity or permissions. A
product with a web frontend, an iOS app and a backend is one app. A worker
that needs other permissions than the backend is a second app. An app can be
just an API or just a job.

An app has:

- **Platforms.** The developer says where the app runs: web, SPA, iOS,
  Android, desktop, CLI, backend. Zitadel creates the right OAuth client for
  each (public or confidential, redirect rules, grants) and shows them as
  platforms of one app. Each platform gets its own client ID
  ([RFC 6749 §2.1](https://www.rfc-editor.org/rfc/rfc6749#section-2.1)), so
  policy, revocation and `azp` stay per platform. "Client" stays the protocol
  term in the API and the protocol docs; the developer rarely needs it.
- **APIs** it serves. An API has an identifier, which is its tokens' `aud`,
  and its scopes and permissions. A token is for one API
  ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)). An API shared by
  several apps has one owning app; the others get access by grant, agents by
  consent. A backend that serves an API and calls another is one app, not
  v4's two apps and a machine user.
- **Machine access**: how the app proves it is itself, offered in this order:
  1. **Trusted workloads.** A GitHub Actions, Kubernetes or cloud OIDC token
     that matches rules on the app (issuer, repository, workflow, service
     account) is exchanged for a Zitadel token, as a token exchange
     ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)) or a client
     assertion ([RFC 7523](https://www.rfc-editor.org/rfc/rfc7523)). Nothing
     is stored and nothing rotates. PyPI's trusted publishing and Entra's
     federated credentials work this way.
  2. **`private_key_jwt`**, with the public key on the app.
  3. **A client secret**, shown once.
- **Outbound protocols**, for apps that need them: a SAML block where Zitadel
  is the identity provider, a SCIM target that provisions the users assigned
  to the app, and claim and attribute mapping derived from the user schema.
  Common SaaS products come from a catalog with these prefilled.
- **Assignments**: who may use the app, which is also who SCIM provisions.

### Connections

A connection is one upstream authority, holding what Zitadel uses it for:

- **Sign-in** through OIDC, OAuth 2.0 or SAML, with claim mapping into the
  user schema and just-in-time creation.
- **Provisioning** through inbound SCIM. Sign-in and provisioning share one
  subject, so a user created by SCIM signs in without a linking step.
- Later, **trusted workloads**: the issuer a CI system or cluster signs with,
  which an app's machine access refers to.
- Later, a **token vault**: the connection keeps the user's upstream tokens,
  so an agent can call Google or GitHub for the user, as Auth0's Token Vault
  does.

Two defaults make connections fast:

- **No setup in development.** Social connections run on Zitadel's shared
  credentials in development, as in Clerk and Auth0, so an agent can add
  Google sign-in without a person visiting Google's console. Production asks
  for the developer's own credentials.
- **Self-serve for B2B.** A connection can belong to a team. The team's IT
  admin gets a setup link for SSO and SCIM, as in WorkOS's Admin Portal, and
  the team's verified domains route its users to it. The developer never
  handles SAML metadata.

An app chooses which connections its sign-in offers, and a team narrows that
for its members.

### Teams

Teams stay the B2B customers they are, and gain team-scoped connections and
verified domains. The name is an open question of its own (see
[Names](#names)).

### Agents

Agents need no noun of their own. They fall into three cases:

| Case | What it is | The token |
| --- | --- | --- |
| Acts for a user on your API, such as an MCP client | A third-party client that identifies itself with a [client ID metadata document](https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/), or registers dynamically ([RFC 7591](https://www.rfc-editor.org/rfc/rfc7591)) as a fallback | `sub` is the user, `client_id` the agent |
| Your own agent, with its own permissions | An app | `sub` is the app; acting for a user through token exchange, `sub` is the user and `act.sub` the app |
| Calls Google or GitHub for the user | The token vault of the connection the user linked | The upstream provider's token |

Agent access is off for each API until its owner turns it on. Consent is per
user, agent and API, and a user sees and revokes their connected agents.
Registered agents belong to the project rather than to an app, and an app
shows the agents that use its APIs.

## Names

| Name | Means | Instead of | Why |
| --- | --- | --- | --- |
| **User** | A person who signs in | "human user", "identity" | Everyone's word |
| **App** | Any software that uses Zitadel | v4's project, the glossary's `app_group`, v4's machine user, ADR 082's `Service` kind | Auth0, Okta, Entra and GitHub all say app |
| **Platform** | Where an app runs | "client" in the console and CLI; "client" stays the protocol term | What a developer already knows; Entra calls its equivalent platforms |
| **API** | What an app serves, with an identifier and scopes | "resource server", v4's API app | Auth0's word |
| **Machine access** | How an app authenticates as itself | "service account", "machine user" | Says what it does; the docs index it under M2M and client credentials |
| **Trusted workload** | A CI or runtime identity accepted instead of a secret | "workload identity federation" | PyPI and npm call it trusted publishing |
| **Connection** | An upstream authority Zitadel trusts | "IdP", "provider" | Auth0's and WorkOS's word. "Provider" already names Zitadel itself, the OIDC provider, and the server side of SCIM |
| **Connected agent** | A third-party agent a user consented to | "dynamic client" | What the user sees |
| **Team** | A B2B customer | — | Unchanged here. The market says organization, and [`decisions.md`](../decisions.md) already lists the name as open |

## How it feels

A sketch, not a command reference:

```text
zitadel app create shop --platform web --platform ios    # sign-in for web and iOS
zitadel app api add shop https://api.shop.com --agents   # protect the API, let MCP clients in
zitadel app access shop --api payments --scope charge    # shop's backend calls payments
zitadel app trust shop --github acme/shop                # CI gets tokens without a secret
zitadel connection add google                            # works in development with shared credentials
zitadel connection invite --team acme                    # Acme's admin sets up Okta and SCIM
```

Every create returns one JSON envelope with the issuer, the client IDs and
the env var names the app reads. Secrets go into the project's variables or
`.env.local`, never into command output an agent would copy into a chat.

## What changes

Measured against what the repo has today:

| Area | Today | With this model |
| --- | --- | --- |
| Glossary | `app` is one OIDC client or SAML SP; `app_group` (LOCKED) holds roles | `app` is the product and holds roles; one OIDC client is a platform, a "client" in protocol docs |
| Authz | Principal types `user`, `team`, `agent`, `sk_proj`, `sk_team`; `agent` is unused | An `app` principal type; `agent` becomes it |
| #2430 | Machines are users of a `service` or `agent` kind; a client is owned by an app, an identity or both; client methods sit in `x-auth-methods` | Machines are apps; every client belongs to an app; client methods move to the platform, and `x-auth-methods` keeps sign-in methods. Its secret format, hashing and PAT design carry over; its client table loses the identity column |
| IdP connections | Project-level, OIDC only, one `protocol` block | Connections hold several blocks (`oidc`, `saml`, `scim`) sharing a subject, and can belong to a team |
| ADR 082 | `Service` app kind; APIs are separate files; token exchange later | Machine access on any app; APIs belong to apps, still one audience per token; token exchange moves up for trusted workloads and agents |
| v4 import | — | v4 projects become apps; v4 apps become platforms, APIs or SAML blocks; v4 machine users become apps with machine access |

Unchanged: tokens stay single-audience, consents stay per user, client and
scope, and registered clients stay project-level, so a declared app and the
agents that use it keep separate writers.

## Open questions

1. **Names.** App or Application; Connection or Provider; Team or
   Organization.
2. **App permissions.** Whether apps hold the same roles as users, or scopes
   only, as in Auth0. Same roles is simpler to explain and to audit.
3. **Client IDs.** One per platform, as proposed, or one per app with rules
   per platform, as in Entra.
4. **Shared development credentials.** Which providers allow them, what their
   consent screens show, and the abuse limits.
5. **Where sign-in offers connections.** Today a user schema lists its
   connections (`x-auth-methods.sso.providers`). This model moves the offer to
   the app and the team, so the kind of user a first sign-in creates needs a
   home: the app, the connection or the schema.
6. **Order.** Platforms and APIs first (#1425), then machine access and
   trusted workloads, then assignments, connections with SCIM, agents, and
   outbound SAML and SCIM.

## Prior art

- **Auth0**: applications including machine-to-machine ones (`sub` is
  `<client_id>@clients`), APIs, connections, organizations, and
  [Token Vault](https://auth0.com/features/token-vault).
- **Okta**: app integrations that carry sign-on and provisioning together.
- **Microsoft Entra**: platforms inside one app registration, and
  [workload identity federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation).
- **GitHub**: GitHub Apps give automation its own identity, short-lived
  tokens and narrow permissions, so it needs no machine user or personal
  token.
- **PyPI**: [trusted publishing](https://docs.pypi.org/trusted-publishers/),
  configured as a GitHub repository and workflow, with no token to store.
- **WorkOS**: the Admin Portal, where a customer's IT admin sets up SSO and
  directory sync.
- **Clerk**: shared OAuth credentials in development, the developer's own in
  production
  ([GitHub connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/github)).
- **Keycloak**, as a warning: a client with service accounts enabled gets a
  hidden user that holds its roles, which is the indirection this model
  avoids.
