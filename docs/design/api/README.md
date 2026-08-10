# Zitadel API Design Guide

> Index for the next-generation API design. Each sibling doc covers one concern; this page exists to orient you and point the way. For vocabulary used throughout, see [`../glossary.md`](../glossary.md).

## Thesis

One surface: `api.zitadel.cloud/*`. Stripe-shaped, Vercel-shaped. No frontend/backend/platform product split. One bearer-token auth model. Self-hosted exposes the identical API shape as cloud — the SDK does not branch on deployment mode. Versioning lives in the `Zitadel-Version` header, not in the URL.

Target properties:

- **Sub-5-minute time-to-login** from signup to a working flow.
- **One credential model** for console, CLI, SDK, and embedded components.
- **Self-hosted and cloud expose the same API shape.** Differences show up as feature availability, not as forks.
- **No endless nested paths.** Globally-unique IDs mean the URL doesn't have to carry scope.
- **No fake-secret client keys.** Browser bootstrap is origin-bound, not key-bound.

## Status markers

Individual decisions are marked inline in each doc:

- **LOCKED** — decided; proceeding unless someone finds a real problem.
- **RECOMMENDED** — leaning toward this, open to debate.
- **OPEN** — unresolved, need input.

## Suggested reading order

1. [`hierarchy.md`](hierarchy.md) — three-layer model (Project / Team / User). Platform is a reserved project.
2. [`credentials.md`](credentials.md) — bearer tokens (`sk_proj_` / `sk_team_`), origin-bound browser challenges, handoff tokens, api_keys as resources.
3. [`url-architecture.md`](url-architecture.md) — flat-by-ID, resource-scope index, scope-bound DAL, slash verbs, no version segment.
4. [`conventions.md`](conventions.md) — IDs, errors, pagination, idempotency A/B split, capabilities split, header-based versioning.
5. [`authn-and-auth-flows.md`](authn-and-auth-flows.md) — auth_attempts state machine, OIDC adapter, SSR handoff.
6. [`authz.md`](authz.md) — credential × scope × permission.
7. [`permission-storage.md`](permission-storage.md) — Wave 0 relational DDL for catalogs, assignments, membership edges, and `resource_scope_index` (feeds issue #422).
8. [`authz-testing.md`](authz-testing.md) — L1–L4 fuzzy/property strategy for compiler, persist, and (later) resolver oracles.
9. [`security-and-origins.md`](security-and-origins.md) — environment-gated origin wildcards, CORS, CSRF.
10. [`resource-map.md`](resource-map.md) — the full endpoint surface grouped by concern.

## Sibling doc sets

- [`../glossary.md`](../glossary.md) — canonical vocabulary.
- [`../platform/`](../platform/README.md) — platform lifecycle: claim, configuration surface, setup-CLI secret storage, `npx zitadel push`.
- [`../flowengine/`](../flowengine/README.md) — flow engine (UI orchestration), session API, user schema, bot detection.

## Relationship to the other doc sets

- **api/** is the protocol surface: what HTTP shapes exist, what each credential can do, how scope resolves.
- **flowengine/** is the UI-orchestration layer that runs *on top of* the auth primitives in [`authn-and-auth-flows.md`](authn-and-auth-flows.md). Flows decide *which step renders when*; auth_attempts expose the primitives flows call into.
- **platform/** is the customer-lifecycle layer: how a project comes into being anonymously, how it attaches to a Team at claim, how `zitadel.json` configures it from source control.

## Draft API specs

The design docs describe intent and invariants. Draft request/response sketches
for this design PR live in:

- [`../platform/api/claim-api.yaml`](../platform/api/claim-api.yaml)
- [`../platform/api/config-api.yaml`](../platform/api/config-api.yaml)
- [`../flowengine/api/flow-api.yaml`](../flowengine/api/flow-api.yaml)
- [`../flowengine/api/session-api.yaml`](../flowengine/api/session-api.yaml)

Specs for auth_attempts, flat api_keys, imports, and capabilities are not yet written.
Events are partially specified in [ADR 049](../../adrs/049-events-api-retention-export.md);
OpenAPI sketch pending.
Implementation OpenAPI source remains under `api/openapi/**`; generated Go code
continues to come from that source, not from these design sketches.
