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
  # Peers trusted to set forwarded headers. A header is honored only when
  # RemoteAddr matches the resolved set; otherwise RemoteAddr is the client.
  # Sources compose; a remote source refreshes rotating edge ranges without a
  # redeploy (see Challenges for the guards it must satisfy).
  sources:
    - static:
        cidrs: [10.0.0.0/8]        # stable infra (our LB / VPC)
    - url:                          # optional: fronted directly by a CDN edge
        endpoint: https://api.cloudflare.com/client/v4/ips
        format: cloudflare          # or: cidr-lines | aws-ip-ranges | gcp
        refresh: 12h
        on_error: keep_last_good    # never fail open

  # First matching header wins; falls back to RemoteAddr.
  client_ip_from:
    - header: X-Forwarded-For   # list: right-to-left, skip trusted hops
    # - header: CF-Connecting-IP  # single value from the CDN
```

## Challenges

The trusted set is not always a fixed list of CIDRs an operator can paste once:

- **Rotating edge-provider CIDRs.** CDNs and clouds publish their edge ranges
  as machine-readable lists — Cloudflare ([`/ips-v4`, `/ips-v6`](https://www.cloudflare.com/ips/)),
  AWS (`ip-ranges.json`), GCP (`cloud.json`), Fastly, Akamai — but they add,
  retire, and reassign ranges continuously and without individual notice. A
  static copy pinned in config therefore drifts, and it fails in two opposite
  and both-bad ways:
  - **Stale-shrink → availability + data corruption.** The provider brings up a
    new edge range we haven't listed. Requests through it fail the trust check,
    so the real client IP silently collapses to the edge's address — every user
    behind that edge now shares one IP, quietly corrupting rate limiting, audit
    trails, geo, and risk signals with no error surfaced.
  - **Stale-grow → spoofing.** The provider retires a range and it gets
    reassigned (cloud IPs are recycled to other tenants). We keep trusting an
    address a third party now controls, and they can forge forwarded headers.
    This is the more dangerous direction — a security regression, not just a
    correctness one.

  So an edge-provider list is never "set once." Keeping it fresh is its own
  mechanism with real concerns: refresh cadence; **source authenticity** (this
  list decides who we trust, so it must be fetched over authenticated TLS and,
  where offered, signature-verified); **fail-safe on fetch failure** (keep
  last-known-good rather than fail open to an empty/all set); propagation across
  replicas; and both IP families (v6 lists are large). It also means a runtime
  dependency on the provider's endpoint, which is itself an availability edge.
- **Ephemeral infra IPs.** Cloud load balancers (AWS ALB, GCP) and Kubernetes
  ingress/pods often have no stable address to pin at all.

Four ways to absorb this, which the config must allow:

1. **Trust by network position** — a private-subnet/VPC CIDR (e.g. `10.0.0.0/8`)
   is stable even when the LB's own IP is not.
2. **Trust by hop count** — trust *N* hops from the right of `X-Forwarded-For`
   regardless of address (cf. Gitea's `REVERSE_PROXY_LIMIT`), sidestepping IPs
   entirely at the cost of assuming a fixed chain length.
3. **Static list** — an operator-pasted set of CIDRs, updated by redeploy;
   simplest, and correct for fixed infra.
4. **Remote source (URL)** — point at a published list and refresh it on an
   interval, so rotating edge ranges stay current without a redeploy. Prior art:
   Caddy's `trusted_proxies cloudflare` module (fetches Cloudflare's API on a
   configurable interval), HAProxy's periodic map/ACL updates, and the common
   AWS `ip-ranges.json` refresh job. This is the direct answer to rotating CIDRs,
   but because the fetched list *defines who we trust*, it carries obligations a
   plain config value does not:
   - **Format contract** — accept one defined shape (newline-delimited CIDRs) or
     a small set of named adapters (`cloudflare`, `aws-ip-ranges`, `gcp`), since
     providers publish different formats.
   - **Authenticity** — fetch over authenticated TLS (pinned host) and verify a
     signature/checksum where offered; a MITM'd list is a trust-bypass.
   - **Fail-safe** — keep last-known-good on fetch failure, never fail open to an
     empty/all set; define boot behavior when the source is unreachable.
   - **Refresh & propagation** — a configurable interval, applied consistently
     across replicas; the source endpoint becomes a runtime availability edge.

The most robust default is still to terminate the dynamic edge upstream of a
proxy **we** own, so `RemoteAddr` is that stable proxy and the edge's changing
ranges never need to be trusted directly — the remote-source option is for
deployments where the CDN edge must be trusted head-on.

## Consequences

- Client IP and host are only believed when they come through a declared proxy;
  direct callers can no longer spoof either.
- Operators behind a proxy must configure `trusted_proxies`; the default assumes
  our standard single-proxy topology, so misconfiguration degrades to
  `RemoteAddr` (the proxy's address) rather than to a spoofable value.
- Vendor CIDR lists are dynamic (see Challenges); they live in operator config,
  never hardcoded in the binary.
