# Zitadel Design Glossary

> Canonical vocabulary for the next-generation design docs. All sub-areas (`api/`, `platform/`, `flowengine/`) reference this file rather than redefining terms. When in doubt, come back here.

## Conventions

- **LOCKED** — decided; proceeding unless someone finds a real problem.
- **RECOMMENDED** — leaning toward this, open to debate.
- **OPEN** — unresolved, needs input.
- **Prose note** — words that still appear informally in narrative (marketing, audience framing) and are not the canonical API term.

---

## 1. Layer hierarchy

Three layers. Long-form in [`api/hierarchy.md`](api/hierarchy.md).

| Term | Meaning |
|---|---|
| **Project** | A tenant / deployment. Owns branding, IdPs, custom domain, feature flags, teams, users, apps, flows, sessions. One project is reserved as the **platform project** — Zitadel's own project, where the accounts that pay Zitadel live. **LOCKED rename** from today's "instance". |
| **Team** | A tenant-grouping inside any project. Two canonical shapes: (a) a team inside the **platform project** represents a paying customer / developer account; (b) a team inside a **customer project** represents a B2B end-customer tenant. Same resource, different project context. |
| **User** | An identity inside any project. A user inside the platform project is what used to be called a "platform_user" (a developer/admin). A user inside a customer project is an end-user. Team participation attaches users to teams; lifecycle ownership is explicit policy. |

Discovering the platform project's `project_id` from the server is target design (the planned `/capabilities` endpoint — see [`api/conventions.md`](api/conventions.md#direction-not-shipped)); no discovery endpoint is shipped today. Self-hosted runs a singleton platform project; cloud resolves whichever project is the caller's platform project.

---

## 2. Lifecycle ownership

Every user has exactly one lifecycle owner inside its project. Long-form in [ADR 024](../adrs/024-user-team-lifecycle-ownership.md).

| Term | Meaning |
|---|---|
| **lifecycle_owner** | The configured local authority for a user's identity lifecycle: `self` or `team`. Separate from membership roles, authorization, and external provisioning source. |
| **self-owned user** | A user that owns its own lifecycle inside the project. Default for self-serve signup and user-created teams. The product may auto-create a personal team/workspace for UX, but team deletion does not delete this user. |
| **team-owned user** | A managed user whose lifecycle belongs to a specific team by policy, common for enterprise invite, JIT, or SCIM-style provisioning. Team deletion or lifecycle-owner membership removal may deactivate the user according to policy. |
| **external provisioning source** | An upstream IdP or directory that is authoritative for attributes or provisioning events. It is source metadata, not a third lifecycle owner; the local user is still self-owned or team-owned. |

---

## 3. Credentials

One bearer-token model everywhere. Long-form in [`api/credentials.md`](api/credentials.md).

| Term | Meaning |
|---|---|
| **user token** | A user's interactive token. Scope resolved per-request against the membership table. |
| **`sk_proj_…`** | Project-scoped service token. The workhorse. Variants: `pre_claim: true` (anonymous, issued at `POST /projects`), claimed (bound to a team at claim time), and origin-scoped (binds to declared preview origins). |
| **`sk_team_…`** | Team-scoped service token with a **narrow permission allowlist**. Cannot escalate to project administration. Same prefix regardless of whether the team lives in the platform project or a customer project. |
| **challenge nonce** | Server-minted, origin-bound, single-use nonce from `POST /bootstrap/challenge`. Replaces the naive "publishable key" concept. The `Origin` header is the real boundary. |
| **handoff_token** | Single-use, TTL ≤ 60s, audience-bound token minted at the end of an auth_attempt, exchanged by the customer's backend for a real session. Idempotency-safe for retries. |
| **api_key** | Globally-addressable resource holding an `sk_*` secret. Secret returned exactly once. Rotate / revoke via verbs on the resource. |

---

## 4. Resources

Core nouns used across the API. Full endpoint map in [`api/resource-map.md`](api/resource-map.md).

| Term | Meaning |
|---|---|
| **project** | See §1. Top-level tenant/deployment. |
| **team** | See §1. Tenant-grouping inside a project. |
| **app** | An OIDC client / SAML SP registered to consume Zitadel; lives in a project. |
| **app_group** | A bundle of related apps that share a role/grant container. **LOCKED rename** from today's "project" (the authz container — not the tenant). |
| **idp** | External identity provider the project federates **to**. Zitadel acts as OIDC/SAML client downstream. |
| **user** | See §1. Identity inside a project. |
| **session** | Durable post-auth container, carries verified factors and every currently satisfied `assurance_levels[]` value. Produced by a completed auth_attempt. Detail in [`flowengine/session-api.md`](flowengine/session-api.md). |
| **grant** | Explicit access record binding a principal to a permission/relation at a scope (user ↔ app, team ↔ project, member ↔ role, or a raw permission/relation assignment). Long-form in [ADR 032](../adrs/032-permission-catalogs.md). |
| **role** | Named permission bundle inside an app_group. |
| **team_membership** | Dedicated team roster/status shape when team participation is stored outside FGA tuples. It can carry roles, provisioning metadata, and member status, but it is not lifecycle ownership; FGA may consume or mirror it for authorization. |
| **auth_attempt** | Ephemeral state machine driving a single authentication attempt. Exposes *auth primitives* (challenges, verify, handoff). OIDC context is owned by the OIDC adapter (`auth_requests`), not by auth_attempt. Long-form in [`api/authn-and-auth-flows.md`](api/authn-and-auth-flows.md). |
| **handoff_token** | Short-lived, audience-bound token produced by `POST /auth_attempts/{id}/handoff`, consumed by `POST /sessions/exchange`. |
| **challenge** | A single-factor challenge (password prompt, OTP, passkey, OIDC redirect) issued inside an auth_attempt. |
| **bootstrap** | The `/bootstrap/*` endpoint family. Two distinct concepts share the prefix: *project bootstrap* (`POST /projects` for anonymous project creation — see [`platform/claim-flow.md`](platform/claim-flow.md)) and *challenge bootstrap* (`POST /bootstrap/challenge` for origin-bound browser nonces — see [`api/authn-and-auth-flows.md`](api/authn-and-auth-flows.md)). |
| **claim** | The transaction that attaches a team (in the platform project) and an accountable human to a customer project. Free. Forced at first production deploy. See [`platform/claim-flow.md`](platform/claim-flow.md). |

---

## 5. Authorization (FGA)

How a permission check is framed and resolved. Long-form in [ADR 032](../adrs/032-permission-catalogs.md)
(shared catalog/storage/resolver core), [ADR 033](../adrs/033-internal-permission-management.md)
(internal/system-catalog specifics), and [ADR 034](../adrs/034-external-permission-management.md)
(external/app-group-catalog specifics).

| Term | Meaning |
|---|---|
| **principal** | Whatever presents a credential to be checked in a permission decision: a user token, an agent, a service token (`sk_proj_…`, `sk_team_…`), or an origin-bound browser nonce. |
| **scope** | The resolved project/team/resource boundary a permission check runs against, produced by `resource_scope_index` before authorization runs. |
| **`resource_scope_index`** | A global lookup table mapping a globally-addressable resource id to its project/team scope, consulted by middleware before authorization runs. See [`api/url-architecture.md`](api/url-architecture.md). |
| **delegation** | An explicit, audited transfer of authority from one principal to another (e.g. a person to an agent), distinct from an agent silently inheriting everything its grantor could do. |

---

## 6. Config terms

From the configuration surface, flow engine, and branding. Long-form in [`platform/configuration-surface.md`](platform/configuration-surface.md), [`flowengine/flow-engine-guide.md`](flowengine/flow-engine-guide.md), and [`branding/README.md`](branding/README.md).

| Term | Meaning |
|---|---|
| **issuer** | Customer-owned origin where the auth UI and OIDC endpoints run. Declared per environment in `zitadel.json`. Serves as security allowlist, token `iss` claim, and magic-link hostname context. |
| **declared issuer** | An issuer entry in `zitadel.json`. The canonical per-environment origin declaration. |
| **renderer** | Client-side surface turning Flow v1 nodes into HTML. One of `default`, `template`, `ejected`. |
| **flow** | The UI-orchestration state machine — decides *which step renders when*. Does **not** hold auth primitives (those live in auth_attempts). Detail in [`flowengine/flow-engine.md`](flowengine/flow-engine.md). |
| **flow definition** | The declarative spec uploaded via `npx zitadel push` that configures a flow. |
| **audience** | The resolution hierarchy for flow definitions: `app > team > schema > project default`. |
| **environment** | A config-version slot: `development`, `preview`, `production`. Governs origin wildcard rules (see [`api/security-and-origins.md`](api/security-and-origins.md)). |
| **drift** | Divergence between the repo's `zitadel.json` and server-side state. Resolves silently in favor of repo. |
| **branding** | The per-project login-appearance resource: layout, asset URLs, and the Liquid template, published as immutable revisions via the Branding API / `zitadel apply`. Flow responses resolve the newest revision. Decisions in [ADR 040](../adrs/040-tenant-login-templates-editable-config.md). |
| **template** (branding) | The LiquidJS artifact the login component renders per step — the `branding.liquid_template` wire field, authored locally as `login.liquid`. What you edit after ejecting; security rules in [`flowengine/template-security.md`](flowengine/template-security.md). Distinct from the `renderer` enum value above. |
| **design** | A named starting point from the shipped catalog (`centered`, `split`, `split-right`, `hero`, `minimal`) that `zitadel branding eject --design` scaffolds. A design *produces* a template; once edited, what you own is a template, no longer a design. Same relationship as sign-in **preset** : flow definition. |
| **layout** | The `branding.layout` wire enum (`centered \| split`) the bundled default template branches on, and the degrade target when a custom template is rejected. Deliberately small — richer looks ship as designs (templates), not new enum values. |

---

## 7. URL shape

**LOCKED: no version segment in paths.** All endpoints live directly under the root (`POST /users`, `GET /teams/{id}`). Header-selected versioning (`Zitadel-Version`, pinned per API key and per webhook endpoint) is target design — the shipped API is unversioned; breaking changes ride the alpha release train. See [`api/conventions.md`](api/conventions.md#direction-not-shipped).

---

## 8. Orthogonal axes

Four independent axes the system moves on.

| Axis | Values |
|---|---|
| **Lifecycle** | pre-claim → claimed |
| **Tier** | Free, Pro, Enterprise (team-scoped billing inside the platform project) |
| **Environment** | development, preview, production |
| **Integration level** | 1 (SSR + in-app), 2 (SPA), 3 (Hosted), 4 (White-label) |

---

## 9. Renames (LOCKED)

| Was | Now | Notes |
|---|---|---|
| instance | **project** | The tenant / deployment. |
| project *(today's authz container)* | **app_group** | Renamed to avoid colliding with the new `project` = tenant. |
| developer *(as API role)* | **user** | API resource term. A developer is a user inside the platform project. "Developer" still allowed in audience prose. |
| platform_user *(earlier proposal)* | **user** | Dropped as a distinct resource. The project context does the work. |
| organization / `org_…` | **team** / `team_…` | Consolidated into a single tenant-grouping concept. Applies to resources, IDs, fields, and credentials. |
| org_membership | **team_membership** | Dedicated team roster/status shape if team participation is stored outside FGA tuples. |
| `sk_org_…` | **`sk_team_…`** | One team-scoped service token prefix. |
| `zp_…` | **`sk_proj_…`** | Pre-claim anonymous secret is `sk_proj_` with `pre_claim: true`. |
| `zpp_…` | **`sk_proj_…`** (origin-scoped) | Origin-scoped variant for preview deploys. |
| path version segment | **no version segment** | Versioning via header only. |

### "Instance" disambiguation

Five distinct uses of "instance" existed in the branch. Each resolves to a different new term:

| Old usage | Example | New term |
|---|---|---|
| The tenant / deployment | "a Zitadel instance hosting two projects" | **project** |
| Flow audience hierarchy default | `app > org > schema > instance default` | **project default** (and `org` becomes `team`) |
| User-schema uniqueness scope | `x-unique: "instance"` | `x-unique: "project"` |
| The Zitadel server / cluster (runtime sense) | "this Zitadel instance has not yet rolled out v2.1" | **Zitadel deployment** |
| OpenAPI subdomain template | `{instance}.zitadel.cloud` | `{region}.zitadel.cloud` |

---

## 10. Prose exceptions

- **developer** — allowed in audience/marketing prose ("developer-first audience"). Not the API resource term.
- **organization** (plain English) — avoid. Use "team" even in prose.
- **platform_user** — never in prose. Say "a user in the platform project" or "a developer".

---

## 11. See also

- [`api/README.md`](api/README.md) — API design guide index
- [`platform/README.md`](platform/README.md) — platform lifecycle, claim, configuration
- [`flowengine/README.md`](flowengine/README.md) — flow engine + session API
