# Security and Origin Allowlist

> Origin validation, environment-gated wildcards, CORS, and CSRF. For vocabulary, [`../glossary.md`](../glossary.md). For how bootstrap challenges use this, [`authn-and-auth-flows.md`](authn-and-auth-flows.md).

## Origin validation is the security boundary

Every API request's `Origin` header is validated against the project's `allowed_origins`. Browser clients do not hold secrets — an identifier in frontend code is an identifier, not a credential. The property we enforce is "this request comes from an origin the project has whitelisted", verified per request.

This means:

- `Access-Control-Allow-Origin` reflects the validated origin, never `*`.
- Credentials allowed for first-party origins; preflight cached.
- Browser bootstrap (`POST /bootstrap/challenge`) rejects requests with missing or malformed `Origin` headers.

## Environment-gated wildcard rules — LOCKED

Projects carry an `environment` flag: `development`, `preview`, or `production`. Wildcard semantics depend on it.

### `development`

- `http://localhost:*` — allowed
- `*.vercel.app`, `*.netlify.app`, `*.pages.dev`, `*.preview-host.example` — allowed
- Custom domain wildcards — allowed

### `preview`

Same as development, plus stricter rate limits and warning banners in the dashboard.

### `production`

- Shared-hosting wildcards (`*.vercel.app` etc.) — **forbidden**, 400 on save.
- Explicit origins — allowed.
- Custom domain wildcards (`*.customer.com`) — allowed (DNS ownership verification is post-MVP; manual dashboard approval at MVP).
- `localhost` — forbidden.

### Promotion

Projects default to `development` at creation. Promoting to `production` is a deliberate action that may fail if any configured origin violates the stricter rules.

> **Post-MVP:** a CI integration (GitHub Action, Vercel plugin) that injects the exact preview URL into the project's allowlist during deploy and removes it on teardown. This eliminates the need for preview wildcards entirely for users who adopt it.

## Error surface

A disallowed browser origin gets a generic error:

```json
{
  "type": "invalid_request",
  "code": "origin_not_allowed",
  "message": "This origin is not allowed for this project.",
  "request_id": "req_…"
}
```

The full allowlist surfaces in the **dashboard diagnostic view**, keyed by `request_id`, so developers can debug without turning the bootstrap endpoint into an origin-enumeration oracle.

## CORS specifics

- Allowed methods reflect the endpoint's verb set.
- Allowed headers: `Authorization`, `Idempotency-Key`, `Zitadel-Version`, `X-Request-Id`, content-type.
- Expose: `X-RateLimit-*`, `Request-Id`, `Zitadel-Version`.
- Preflight cache: `Access-Control-Max-Age: 3600` on stable endpoints.

## CSRF for cookie-carrying first-party components

The concept is bearer-everywhere, but embedded lit components running on the customer's domain may still ride on cookies for UX reasons. For those:

- `SameSite=Lax` or `Strict` where the flow allows.
- `HttpOnly`, `Secure`.
- Anti-CSRF token on unsafe methods (`POST`/`PATCH`/`DELETE`) tied to the session.

> **OPEN:** Exact anti-CSRF mechanism — double-submit, header-pin, or signed-token. Standard answer is double-submit; will commit with the first embedded-component release.

## Custom domain wildcards

Custom domain wildcards (`*.customer.com`) are allowed in `production` but MVP uses manual dashboard approval. DNS-based ownership verification is the target.

> **OPEN:** DNS challenge mechanism. Options: TXT record, CNAME to a verification endpoint, something else. Decision deferred until we have a customer who needs it.

## Relation to `zitadel.json` declared issuers

The developer-facing way to declare origins is `environments.*.issuer` / `issuer_pattern` in `zitadel.json` — see [`../platform/configuration-surface.md`](../platform/configuration-surface.md). `npx zitadel push` propagates the declared issuers into the project's `allowed_origins` on the server. The two views are kept in sync by the push command.

## See also

- [`../glossary.md`](../glossary.md)
- [`authn-and-auth-flows.md`](authn-and-auth-flows.md) — bootstrap challenge
- [`credentials.md`](credentials.md#origin-bound-browser-challenges) — origin-bound nonces
- [`../platform/configuration-surface.md`](../platform/configuration-surface.md) — `zitadel.json` declared issuers
