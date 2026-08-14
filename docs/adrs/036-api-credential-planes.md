# ADR 036: API Credential Planes — Public, App, and Operator

> **Status:** Proposed
> **Date:** 2026-07-17
> **Amended:** 2026-08-03 — credential exposure contracts; server-originated
> me-ops; SSR session validation at the render layer
>
> **Proposed amendment — [ADR 052 §5](052-cross-project-principals.md#5-first-party-human-sessions-may-call-the-operator-plane):**
> if ADR 052 is accepted, the operator plane no longer always authenticates
> calling *software*. An operator-plane operation may authenticate either
> confidential automation (project secret, later a PAT or service-user
> credential) or a human through the first-party Console session cookie. Both
> paths enter the same authorization resolver; the operation stays
> operator-plane because of what it manages, not which credential carried it.
> **Context:** Which APIs are callable from a browser, with which credential, and where each credential lives

## Context

The API surface already behaves as three implicit tiers, but the model has never
been named, and one operation contradicts it:

- The **flow endpoints** (`createFlow`, `getFlowStep`, `submitFlowStep`) are
  declared `security: []`. The handlers authenticate no
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

Because of that one operation, every framework scaffold proxies `/__nextgen/*`.
Before the transitional hardening below, those proxies stamped
`ZITADEL_PROJECT_SECRET` onto **every** proxied request (#310; previously the
scaffolds sent a placeholder bearer synthesized from the public project id). In
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

**Implementation note (2026-08-02):** until the publishable-key path in this
ADR lands, framework proxies attach the project secret only to the exact
`POST /sessions/exchange` operation that still requires it. Public-plane and
management operations receive no infrastructure-supplied bearer. This closes
the operator-capable open relay immediately while keeping the current handoff
exchange working; it is an interim step, not completion of this ADR.

## Decision

Every operation declares which **credential planes** may call it, encoded in
the OpenAPI spec via its security schemes. Most operations accept exactly one
plane; `exchangeHandoff` is deliberately dual-plane (see below). The invariant:

> A **public-plane** operation authenticates the request's *human* — or is in
> the process of establishing who that human is — and never the calling
> software. App identity on the public plane is attribution and scoping, so its
> credential must be safe to publish. **Confidential-plane** operations — those
> on the app and operator planes — authenticate the calling *software* as the
> principal.

Litmus test for new endpoints: *if this credential leaked into a browser
bundle, is anything lost?* If the answer must be "no", the operation is
public-plane.

| Plane | Principal | Credential | Operations (today) |
|---|---|---|---|
| **Public** (browser) | The human / their session | Publishable key (+ session cookie for me-ops) | flow ops, `exchangeHandoff` (see below), me-ops, OIDC authorize/jwks/well-known, health probes |
| **App** (deployment) | The running server-side app | Project secret | auth_attempts, challenges, `createHandoff`, `createSession`, `exchangeHandoff`, introspection |
| **Operator** (CLI/CI/console) | The operator or automation | Project secret today; PATs/service users with the specced resource scopes later (token lifecycle ADR, PR #450) | schemas, flow definitions, project patch/query, users, teams, releases/deployments (ADR 035) |

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

### Server-originated me-ops

An SSR app reading a cookie-principal operation (`getMySession`) on behalf of
its user — the framework middlewares' and `auth()`'s session validation — is
**public-plane software acting for the human**: it presents the publishable
key for attribution plus the user's session cookie as the principal. It does
not need — and must not use — the project secret, which preserves the
zero-platform-secrets endgame for SSR deployments.

The origin allowlist does not blanket these calls. Origin enforcement is an
honest-browser control (CSRF, embedding, WebAuthn RP-ID derivation), so the
verifier scopes it by operation class:

- **Credential-establishing ops** (flow ops, the public-plane handoff
  exchange) always enforce the allowlist.
- **Cookie-principal mutations** (`revokeMySession`) enforce it when a
  browser-attested `Origin` is present — a cross-site page's forced-logout
  attempt arrives with the attacker's `Origin` and is rejected — while
  server-originated calls, which carry no `Origin`, pass on the cookie.
- **Cookie-principal reads** (`getMySession`, `getMyUser`) skip it: the
  cookie is a strictly stronger credential than an attacker-settable
  `Origin` header, and cross-origin browser reads are already unreadable
  under CORS without a matching `Access-Control-Allow-Origin`.

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

### Credential exposure contracts

The litmus test generalises: every credential class carries an **exposure
contract**, and every new endpoint or SDK surface is checked against the
contract of each credential it touches — not only "may this live in a browser
bundle" but "which surfaces may this value ever appear on".

| Credential | May appear in | Must never appear in |
|---|---|---|
| Publishable key | Committed `zitadel.json`, browser bundles, request headers | — (safe to publish is its definition) |
| Project secret | Server env, platform secret stores, `.zitadel/secret`; server memory and the `Authorization` header of the app- and operator-plane calls it authenticates | Browser-readable content, committed files, blind attachment to browser-originated traffic (the stamped proxy this ADR removes) |
| Session token | The `__nextgen_session` HttpOnly cookie; server memory while handling the request | Anything script-readable: HTML/DOM, serialised SSR/RSC payloads, client-side state, non-HttpOnly cookies, URLs, logs |
| Handoff token | Flow-completion response body (same-origin, one-time, short-TTL) | URLs, unless exchanged with the proof binding above |

The session-token row makes explicit what the HttpOnly cookie already
implies: **no server-side surface may re-materialise the token into
browser-readable content.** OIDC access and refresh tokens keep their
contracts in ADR 037. Wired enforcement today: `@zitadel/sdk-nuxt` strips the
token before seeding its SSR payload; `@zitadel/sdk-next`'s `NextgenProvider`
converts to the client-safe shape on the server and is `server-only`, so a
client-side wrapper cannot move the boundary above the strip. A demo-next
e2e assertion additionally checks the raw token appears nowhere in a
rendered response (PR #718) — today that lane is opt-in, not CI enforcement;
promoting it into the CI-run e2e lane is remaining work below. Exposure
contracts are testable exactly that way — response bodies and serialised
payloads are assertable surfaces — and new SDK integrations are expected to
carry the equivalent leak guard in a lane CI runs.

### Proxies become credential-free

With no secret to inject, the same-origin `/__nextgen/*` hop exists only for
CORS and first-party cookies:

- **Dev:** the scaffolded dev proxies stop reading `ZITADEL_PROJECT_SECRET`
  and become plain path forwarders (dev/prod parity).
- **Production SPA:** a `vercel.json` rewrite or `netlify.toml` redirect; a
  minimal worker only on Cloudflare (its redirects cannot proxy external
  origins). No published proxy package is required.

### SSR session validation happens at the render layer

The framework middlewares' header tunnel (`x-nextgen-auth-token`) was an
unnamed intra-app credential channel: a trusted transport for a bearer that
exists only on matcher-covered routes and is spoofable wherever the
middleware does not run. PR #718 closed the spoof by re-verifying the header;
this ADR removes the channel instead:

- **`auth()` reads the session cookie directly** and validates it as the
  session class: ADR 037 session tokens are opaque and server-authoritative,
  so the check is the server-originated `getMySession` read above. It works
  on every route; the middleware `matcher` constrains only redirects,
  aligning server-side reads with `getSession()`.
- **The `Authorization` bearer in Route Handlers is a different credential
  class with different rules**: an ADR 037 access token (`typ: at+JWT`),
  verified via JWKS **with a mandatory audience** naming this app. With no
  audience configured, the bearer path is off and such requests are
  unauthenticated — never "any token this issuer ever signed": without the
  audience bind, a token minted for a different client would authenticate
  here. (The shipped verifier still defaults to no audience check and also
  accepts `typ: JWT`; tightening those defaults is remaining work below.)
- **Middleware keeps two jobs**: the credential-free proxy hop and redirect
  gating for `protectedRoutes`, where it retains full validation — a
  structural-only check there would render signed-out content instead of
  redirecting. Validation cost is ADR 037's authoritative-session read, once
  per render, doubled only on protected routes.
- **No attestation channel replaces the tunnel.** An HMAC handshake between
  middleware and render layer would need a durable shared secret in exactly
  the layer this ADR empties of secrets; the option is foreclosed, not
  deferred.

Specced vs wired: `getSession()` (PR #717) is this model's client half,
shipped. PR #718's verification core — `verifyJwt` with middleware-parity
options, opaque validation with identity mapping, the client-safe boundary —
is the server half, shipped behind the old header transport. The remaining
work is the transport swap: read `cookies()`/`Authorization` in `auth()`,
delete the tunnel plumbing, attach the publishable key once it exists, and
sweep the matcher-precondition prose (SDK docstrings, READMEs, scaffold
guidance, the `getSession()` server-side error text). Two items ride along:
tightening the bearer defaults (mandatory audience, `at+JWT` only) per the
bullet above, and promoting the session-leak assertion into the CI-run e2e
lane. `@zitadel/sdk-nuxt` already validates every non-proxy, non-ignored
request — there is no matcher concept to outgrow; its remaining change is
publishable-key wiring only.

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
- **#310 is partially reverted in spirit:** proxies now restrict the project
  secret to `POST /sessions/exchange`; once the publishable-key path lands,
  proxied SPA traffic stops carrying it entirely. SSR middlewares keep the
  secret for app-plane calls.
- Public-plane hardening (rate limits, enumeration-safe errors, bot gates)
  is the assumed baseline for flow traffic and is unchanged by this ADR.
- **The tunnel-spoof class disappears structurally.** With no
  `x-nextgen-auth-token` channel there is nothing for a client to forge on
  uncovered routes; PR #718's verification engine remains as the validation
  path, no longer as a trust patch on the transport.
- The exposure contracts give every SDK a testable invariant; the demo-next
  leak assertion (raw token absent from the full rendered response) is the
  template for other framework integrations once it moves into a CI-run
  lane.

## Out of scope

- Per-app OAuth client credentials for the app plane; operator PATs/service
  users (token lifecycle ADR, PR #450).
- Per-environment publishable keys before ADR 035 environments are
  implemented.
- Per-operation scope enforcement in `HandleOAuth2` (#207).
