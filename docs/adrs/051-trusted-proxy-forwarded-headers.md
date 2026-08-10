# ADR 051: Trusted-Proxy Resolution of Forwarded Headers

> **Status:** Proposed
> **Date:** 2026-08-10
> **Context:** Follow-up from [#772](https://github.com/zitadel/nextgen/pull/772)
> (capturing the client IP for flow-created sessions)

## Context

We derive request data from proxy-forwarded headers in two places, each
hand-rolled and each simply assuming the fronting proxy is trusted:

- `WithRequestHostMiddleware` (`internal/api/security.go`) — `X-Forwarded-Host` /
  `X-Forwarded-Proto`.
- `clientIP` (`internal/api/middleware/user_agent.go`) — first hop of
  `X-Forwarded-For`.

Forwarded headers are set by whoever makes the request, so they cannot be
trusted on their own: a client can send `X-Forwarded-For: 1.2.3.4` (or
`CF-Connecting-IP`) straight to our origin and forge its address. The only value
a client cannot forge is `RemoteAddr` — the peer that actually opened the
connection — because completing the TCP/QUIC handshake requires controlling that
address.

A header is therefore trustworthy only when `RemoteAddr` is a proxy **we** put
in front of the app. Which peers those are is deployment-specific: only the
operator knows the topology. This is the well-established "trusted proxies"
pattern (nginx `real_ip`, Laravel/Symfony, ASP.NET Core, Nextcloud).

## Decision

### 1. One trusted-proxy configuration

The operator declares the proxy peers we trust. A forwarded header is honored
only when `RemoteAddr` matches the trusted set; otherwise `RemoteAddr` is the
client. The default is safe for our current single-proxy deployment.

### 2. Shared resolution helpers

Real client IP, host, and proto are resolved by shared helpers that honor the
config, supporting both header shapes:

| Shape | Example | Resolution |
|---|---|---|
| List | `X-Forwarded-For` | walk right-to-left, discard trusted hops, take first untrusted |
| Single value | `CF-Connecting-IP`, `True-Client-IP` | honored only when the peer is trusted |

### 3. Both middlewares move onto the helpers

`clientIP` and `WithRequestHostMiddleware` are reimplemented on the shared
helpers so they cannot diverge. Behavior is unchanged under the default config.

```yaml
trusted_proxies:
  # Peers trusted to set forwarded headers. Headers are honored only when
  # RemoteAddr matches one of these; otherwise RemoteAddr is the client.
  cidrs:
    - 10.0.0.0/8
    # - <cloudflare-ranges>   # when fronted by Cloudflare

  # First matching header wins; falls back to RemoteAddr.
  client_ip_from:
    - header: X-Forwarded-For   # list: right-to-left, skip trusted hops
    # - header: CF-Connecting-IP  # single value from the CDN
```

## Consequences

- Client IP and host are only believed when they come through a declared proxy;
  direct callers can no longer spoof either.
- Operators behind a proxy must configure `trusted_proxies`; the default assumes
  our standard single-proxy topology, so misconfiguration degrades to
  `RemoteAddr` (the proxy's address) rather than to a spoofable value.
- CDN vendor ranges (e.g. Cloudflare) change over time; they belong in operator
  config, never hardcoded in the binary.
