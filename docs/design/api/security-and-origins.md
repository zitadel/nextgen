# Security and Origin Allowlist

> Origin validation, environment-gated wildcards, CORS, and CSRF. For vocabulary, [`../glossary.md`](../glossary.md). For how bootstrap challenges use this, [`authn-and-auth-flows.md`](authn-and-auth-flows.md).

## Origin validation is the security boundary

Browser and origin-bound runtime requests present an `Origin` header that is validated against the project's `allowed_origins`. Browser clients do not hold secrets — an identifier in frontend code is an identifier, not a credential. The property we enforce is "this request comes from an origin the project has whitelisted", verified per request. CLI and other direct platform calls authenticated with the full project secret are not expected to present a customer origin.

This means:

- `Access-Control-Allow-Origin` reflects the validated origin, never `*`.
- Credentials allowed for first-party origins; preflight cached.
- Browser bootstrap (`POST /bootstrap/challenge`) rejects requests with missing or malformed `Origin` headers.

## Environment-gated wildcard rules — LOCKED

> **Amended 2026-09-10.** This section was written before a project had
> environments under it, so it put the class on the project. A project holds
> several environments and they do not share one set of origin rules — a
> project's `dev` accepts `http://localhost:3000` while its `prod` must not.
> The class therefore belongs to the environment, as a boolean, and the rules
> below are unchanged other than being read per environment. See
> [ADR 061](../../adrs/061-environment-lifecycle-and-classes.md).

Each environment carries a `production` flag. Wildcard semantics depend on it.

### Non-production

- `http://localhost:*` — allowed
- `*.vercel.app`, `*.netlify.app`, `*.pages.dev`, `*.preview-host.example` — allowed
- Custom domain wildcards — allowed

Preview-style environments were previously a third class. They differed from
development only in stricter rate limits and warning banners in the dashboard,
never in an origin rule, so the class collapses to a boolean here and a rate
limit that needs to vary per environment is its own field.

Rate limits are enforced at the edge/API layer, before expensive auth, flow,
and delivery work runs.

### Production

- Shared-hosting wildcards (`*.vercel.app` etc.) — **forbidden**, 400 on save.
- Explicit origins — allowed.
- Custom domain wildcards (`*.customer.com`) — allowed.
- `localhost` — forbidden.

### Promotion

Environments default to non-production. Declaring one `production` is a deliberate action that may fail if any configured origin violates the stricter rules.

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

Custom domain wildcards (`*.customer.com`) are allowed on a production environment. The declaration is accepted as written, as every other origin declaration is.

> **OUT OF SCOPE:** Gating a wildcarded domain on proof of ownership — whether an approval step or a DNS challenge (TXT record, CNAME to a verification endpoint, something else). Nothing verifies the domain today. Revisit when a customer needs it.

## Relation to declared issuers

The developer-facing way to declare origins is `issuer` / `issuer_pattern` on each environment, and the CLI propagates the declared issuers into `allowed_origins` on the server. The two views are kept in sync by that command; the declaration is the input and `allowed_origins` is the projection of it.

> **Amended 2026-09-10.** These fields were declared under `environments.*` in `zitadel.json`. They move to `.zitadel/environments/<name>.json`, one file per environment — see [ADR 061](../../adrs/061-environment-lifecycle-and-classes.md). What they mean here is unchanged.

## See also

- [`../glossary.md`](../glossary.md)
- [`authn-and-auth-flows.md`](authn-and-auth-flows.md) — bootstrap challenge
- [`credentials.md`](credentials.md#origin-bound-browser-challenges) — origin-bound nonces
- [`../platform/configuration-surface.md`](../platform/configuration-surface.md) — declared issuers
- [`../../adrs/061-environment-lifecycle-and-classes.md`](../../adrs/061-environment-lifecycle-and-classes.md) — environment lifecycle and the `production` class
