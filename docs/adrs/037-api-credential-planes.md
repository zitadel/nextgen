# ADR 037: API Credential Planes — Public, App, and Operator

> **Status:** Proposed
> **Date:** 2026-07-17
> **Context:** Which APIs are callable from a browser, with which credential, and where each credential lives

## Context

The API surface already behaves as three implicit tiers, but the model has never
been named, and one operation contradicts it:

- The **flow endpoints** (`createFlow`, `getFlowStep`, `submitFlowStep`,
  `submitFlowEvent`) are declared `security: []`. The handlers authenticate no
  caller; the gates are `project_id` in the request, the `PreviewOrigins`
  allowlist (browser-attested `Origin`, which also derives the WebAuthn RP ID),
  and — per ADR 019 — bot signals.
- The **me endpoints** (`getMySession`, `revokeMySession`, `getMyUser`) use the
  `__nextgen_session` cookie. The principal is the user's session.
- The **management surfaces** (schemas, flow definitions, project patch/query,
  users, teams, auth_attempts and its challenge/handoff primitives) require an
  OAuth2 bearer with resource scopes.
- **`exchangeHandoff`** — the call that turns a completed flow's one-time
  handoff token into a session — requires a project service key. It is the only
  secret-requiring operation in the SPA browser path.

Because of that one operation, the framework scaffolds proxy `/__nextgen/*` and
stamp `ZITADEL_PROJECT_SECRET` onto **every** proxied request (#310; previously
they sent a placeholder bearer synthesized from the public project id). In
production this forces secret-holding edge compute on every hosting platform
(PR #56), because a static rewrite cannot inject a header from a secret store.

That requirement buys less than it appears to. The proxy is an unauthenticated
public endpoint that attaches the secret to any traffic reaching it — an open
relay — so possession of the secret does not distinguish trusted callers, and
the flow API must withstand anonymous abuse regardless. Meanwhile the stamped
secret is project-wide: any script on the page can reach operator-grade APIs
through the proxy path with full authority (scope enforcement is deferred
pending #207). The industry pattern for browser-facing auth traffic
(Clerk, Auth0, WorkOS, Supabase) is the inverse: a **publishable** app
identifier plus origin restrictions, with secrets reserved for server-side
surfaces. The domain model already contains that credential class:
`PreviewSecret` is an origin-scoped bearer with a `PreviewOrigins` allowlist —
quarantined under a preview/testing label.

## Decision

Every operation is assigned to exactly one **credential plane**, encoded in the
OpenAPI spec via its security scheme. The invariant:

> A **public-plane** operation authenticates the request's *human* — or is in
> the process of establishing who that human is — and never the calling
> software. App identity on the public plane is attribution and scoping, so its
> credential must be safe to publish. **Confidential-plane** operations
> authenticate the calling *software* as the principal.

Litmus test for new endpoints: *if this credential leaked into a browser
bundle, is anything lost?* If the answer must be "no", the operation is
public-plane.

| Plane | Principal | Credential | Operations (today) |
|---|---|---|---|
| **Public** (browser) | The human / their session | Publishable key (+ session cookie for me-ops) | flow ops, `exchangeHandoff` (see below), me-ops, OIDC authorize/jwks/well-known, health probes |
| **App** (deployment) | The running server-side app | Project secret | auth_attempts, challenges, `createHandoff`, `createSession`, `exchangeHandoff`, introspection |
| **Operator** (CLI/CI/console) | The operator or automation | Project secret today; PATs/service users with the specced resource scopes later (ADR 036) | schemas, flow definitions, project patch/query, users, teams, releases/deployments (ADR 035) |

App and operator planes share the project secret today; they are named
separately because their credential trajectories diverge.

### Publishable key

`PreviewSecret`/`PreviewOrigins` is promoted to a first-class **publishable
key**: an origin-scoped bearer carried on all public-plane calls.

- Sent by browser SDKs as the bearer (configured through `configureZitadel()`,
  ADR 016). It resolves the project (and later the environment) server-side,
  replacing loose `project_id` request fields as the attribution mechanism.
- A **non-empty origin allowlist is mandatory for production use**; empty
  allowlists (allow-all) remain permitted for development. Once ADR 035
  environments exist, keys are issued per environment and allow-all is
  restricted to non-production environments; until then a project has a single
  publishable key.
- Declared as a `publishableKey` security scheme in `api/openapi/security/`;
  public-plane operations reference it. The spec is the machine-readable plane
  registry — docs derive the "public API" list from it.
- Rotation and revocation work like the project secret's; the verifier accepts
  it only on public-plane operations.

### The handoff exchange

`exchangeHandoff` becomes dual-plane:

- **App plane (unchanged):** a project service key exchanges any handoff.
  SSR middlewares (`@zitadel/sdk-next`, `@zitadel/sdk-nuxt`) keep working as
  they do today.
- **Public plane (new):** a publishable key may exchange a handoff when the
  origin check passes and the handoff was **body-delivered** — returned in the
  flow-completion response on the same origin, one-time, short-TTL. Interception
  resistance comes from the token never transiting a URL.
- Handoffs that transit URLs (cross-context: redirects, popup-to-app) require a
  **proof binding**: a verifier bound at flow start and presented at exchange
  (PKCE-style, RFC 7636 semantics). This is specified here but may ship after
  the body-delivered path; until it ships, URL-delivered handoffs remain
  app-plane only.

### Where credentials live

- **`.zitadel/secret`** (gitignored): the project secret. Unchanged (ADR 005).
- **`zitadel.json`** (committed): project id, environment, and the publishable
  key — public-safe by construction, so committing it is allowed and makes
  clone-and-run work without an env-var step for the browser side.
- **Platform secret stores**: needed only by app-plane deployments (SSR).
  The SPA golden path ships zero platform secrets.

### Proxies become credential-free

With no secret to inject, the same-origin `/__nextgen/*` hop exists only for
CORS and first-party cookies:

- **Dev:** the scaffolded dev proxies stop reading `ZITADEL_PROJECT_SECRET`
  and become plain path forwarders (dev/prod parity).
- **Production SPA:** a `vercel.json` rewrite or `netlify.toml` redirect; a
  minimal worker only on Cloudflare (its redirects cannot proxy external
  origins). No published proxy package is required.

## Consequences

- **PR #56 is superseded for SPAs.** The edge-proxy package's distinguishing
  job (secret injection) disappears. Its deploy-target detection is salvaged
  into rewrite/worker scaffolding. Framework patcher READMEs and docs that
  reference `@zitadel/edge-proxy` are corrected.
- **The confused-deputy exposure closes structurally.** Browser-reachable
  paths no longer have an operator-capable bearer attached by infrastructure;
  this no longer depends on per-operation scope enforcement (#207), which
  remains required for the app and operator planes.
- **ADR 019 interaction:** the secret-authenticated edge bot-verdict header is
  an app-plane channel. SPA deployments without edge compute fall back to the
  in-flow captcha gate and server-side signals; SSR deployments keep the
  authenticated verdict channel.
- **#310 is partially reverted in spirit:** proxied SPA traffic stops carrying
  the project secret once the publishable-key path lands; SSR middlewares keep
  the secret for app-plane calls.
- Public-plane hardening (rate limits, enumeration-safe errors, bot gates)
  is the assumed baseline for flow traffic and is unchanged by this ADR.

## Out of scope

- Per-app OAuth client credentials for the app plane; operator PATs/service
  users (ADR 036 token lifecycle).
- Per-environment publishable keys before ADR 035 environments are
  implemented.
- Per-operation scope enforcement in `HandleOAuth2` (#207).
