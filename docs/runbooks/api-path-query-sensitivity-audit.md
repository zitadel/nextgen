# API path and query sensitivity audit

> **Status:** Checklist (2026-07-22)
> **Related:** [ADR 030 §6](../adrs/030-error-model-mapping-and-reporting.md), [#585](https://github.com/zitadel/nextgen/issues/585)

## Rule

URLs are **safe-to-log by construction**: path and query parameters may appear in proxies, access logs, browser history, and `Referer`. **No secret or PII may be carried in path or query** — those belong in headers or the request body.

This runbook records pass / find / defer per public surface. Fixes that change OpenAPI contracts are tracked separately.

## Checklist

| Surface | Parameter | Kind | Verdict | Notes |
|---------|-----------|------|---------|-------|
| Resource CRUD (`/projects/{id}`, `/users/{id}`, …) | `{project_id}`, `{user_id}`, … | path | **Pass** | Opaque domain IDs, not direct PII |
| `GET /sessions` | `user_id` | query | **Find** | User identifier in query string; acceptable for admin filtering today — document only; body-based filter would be breaking |
| `GET /sessions` | `state`, `project_id`, pagination | query | **Pass** | Enum / opaque IDs |
| OAuth `GET /oauth/authorize` | `client_id`, `redirect_uri`, `scope`, … | query | **Pass** | OIDC/OAuth public client metadata |
| OAuth `GET /oauth/authorize` | `login_hint` | query | **Find** | May carry email/login identifier (OIDC spec); defer code change |
| OAuth `GET /oauth/authorize` | `id_token_hint` | query | **Find** | May carry token material (OIDC spec); defer code change |
| OAuth `GET /oauth/end-session` | `id_token_hint`, `post_logout_redirect_uri` | query | **Find** | Spec-driven; defer |
| Flow submit `POST /flow/{id}/submit` | `_zflow` | cookie | **Pass** | Encrypted state handle, not user PII |
| Session cookie routes | session token | cookie/header | **Pass** | Credential in cookie/header, not URL |
| Schema / flow-definition filters | `purpose`, pagination | query | **Pass** | Non-sensitive enums and tokens |

## Schema sensitivity (`x-sensitive`)

- **Canonical extension:** `x-sensitive` on user schema properties ([`user-property.yaml`](../../api/openapi/endpoints/schemas/user-property.yaml)).
- **Helper:** [`domain.IsSensitiveProperty`](../../internal/domain/schema_sensitive.go) for future producers.
- **API errors:** Producers must not embed values of `x-sensitive: true` fields in `message` or `details` (see [error-details-producers.md](../design/api/error-details-producers.md)).

## Verification

```sh
# Re-run when OpenAPI routes change:
rg 'in: query' api/openapi/endpoints -l
rg 'in: path' api/openapi/endpoints -l
```

## Deferred follow-ups

- `login_hint` / `id_token_hint` on authorize — product/OIDC compatibility review before moving off query string.
- `GET /sessions?user_id=` — consider POST filter body in a future API revision if query logging is a concern.
