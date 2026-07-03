# ADR 026: Token lifecycle

> **Status:** Proposed
> **Date:** 2026-06-30
> **Context:** Evolution of session security

## Context

A production IAM must have a clear server-authoritative model for sessions and
tokens. The platform has session/auth-attempt primitives and token metadata,
but lacks a consolidated architecture for token classes, refresh token rotation/
binding/replay detection, revocation semantics, and how logout/password/factor
changes invalidate credentials. This ADR will define the authoritative session
model, token families, revocation propagation, and incident/administrative
invalidation flows. Without this, token misuse, inconsistent invalidation, and
recovery gaps become likely.

## Decision

|                             | Audience        | Owner  | Token type                           | Lifespan                                                                         | Note                                                                                                                                                                                                                     |
|:----------------------------|:----------------|:-------|:-------------------------------------|:---------------------------------------------------------------------------------|:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Session Tokens              | First-party app | Server | Opaque                               | Session bound                                                                    | First-party applications need to know whether a session is still active or revoked, whether the user was deactivated,... Those are better served by an authoritative session row than by a self-contained browser token. |
| Access Tokens               | Third-party app | Client | Signed JWT (but opaque configurable) | Short: minutes (default 5 min)                                                   | For short-lived edge tokens we optimize for performance. If a token is self-contained, no database or even api call is required. This reduces system-load and increases responsiveness of the applications.              |
| Refresh Token               | Auth server     | Client | Opaque                               | Long: days/weeks (default 2 weeks)                                               | Because refresh tokens are long-lived, they need to be single-use. This is to mitigate replay attacks. Refresh tokens need to be exchanged for access-tokens. In the token response, an new refresh token is provided.   |
| Personal Access Token (PAT) | Auth server     | Client | Opaque                               | Very long: months/years/infinite (default 3 months, infinite: not recommendable) | PATs need to be exchanged for access-tokens.                                                                                                                                                                             |

### Signed JWT

According to [RFC7519](https://datatracker.ietf.org/doc/html/rfc7519)

By default, provide some standard claims:

```json
{
  "iss": "https://auth.example.com",
  "sub": "123456789",
  "aud": [
    "the_audience_"
  ],
  "iat": 1516299022,
  "exp": 1516239022,
  "scope": "openid email"
}
```

### Opaque tokens

For opaque tokens, we use an encrypted JWT (JWE). This is done because it is an
established standard. We can use vetted libraries to establish this.

An opaque token always contains a `jti` claim so that the server can verify that
the token is still active. Additional claims can be added to minimize the amount
of database round-trips and required compute to validate whether a token is
active. E.g.: a session token will have the `session_id` claim so that the
server can validate whether the session/user is still active.

### Storage

All tokens should be stored in the server because the need to be able to be 
revoked. The storage of these tokens is minimal. Only the token-id. All other
information can be retrieved from the token itself. Since all tokens are signed
we can trust the information which is encoded in them, we only need to ensure 
the tokens are active.

Once a token is revoked, we can mark the token as inactive in the database which
will make future validations fail.

### Refresh token Rotation & Replay detection

To mitigate token interception and misuse, refresh tokens are single use. When
a refresh token is used, it is removed/marked as used/inactive in the database.
In the token response at the end of its exchange, a new refresh token is
returned. This token can be used for the next refresh.

[RFC7009 for token revokation](https://datatracker.ietf.org/doc/html/rfc7009#section-2.1)
states:
 
> The invalidation takes place immediately, and the token cannot be used again 
> after the revocation.

However, experience learns that some clients do not handle this well. Therefore, 
The revokation endpoint will be idempotent.

### Revocation propagation & invalidation semantics

When a security event occurs (explicit logout, password reset, multifactor
credential removal, or administrative user blocking), invalidation propagates
via two distinct operational models.

1. First-Party Surfaces (Immediate): Session tokens evaluate directly against
   the server on every single call. Administrative lockouts or logouts take
   effect instantly on all first-party UI/UX applications.
2. Third-Party Edges (Eventually Consistent): Active Access Tokens cannot be
   revoked once published validated offline. They naturally burn out at the end
   of their 5-minute lifespan.
