# ADR 062: Egress Policy for User-Injectable URLs

> **Status:** Proposed
> **Date:** 2026-09-10
> **Context:** #1114 (schema ingest fetch had no limits), epic #928 (egress policy), advisory [GHSA-29jh-8cfq-rr8x](https://github.com/zitadel/zitadel/security/advisories/GHSA-29jh-8cfq-rr8x) in zitadel/zitadel
> **Builds on:** [ADR 030](030-error-model-mapping-and-reporting.md) (error mapping), the [Server-Side Fetch Policy](../design/idp/3-social-login-flow.md#server-side-fetch-policy)

## Decision

Every fetch of a URL that a **platform user can inject** goes through one
hardened HTTP client, built by `internal/httputil.ClientConfig.NewClient()`.
Schema ingest by URL (`POST /schemas`, `kind: schema-url`, including every
`$ref` it follows) is the first consumer; social login (#851) and
tenant-configurable webhooks adopt the same client when they land.

The threat model is server-side request forgery: the guard exists exactly
where a user of the platform chooses the URL. Endpoints only the operator
configures stay on standard-library clients, deliberately:

- the audit export sink (`internal/audit/shipper.go`): deployment YAML, and
  sinks legitimately live on private networks the deny list blocks;
- the OpenTelemetry exporters: the SDK owns their transport, and collectors
  commonly listen on loopback, so the policy would blackhole telemetry.

### The mechanism (ported from zitadel/zitadel, commit `b6f78086`)

1. **Deny at dial time, on the resolved address.** A `net.Dialer.Control`
   hook checks the exact IP the kernel is about to connect to, after DNS
   resolution and before `connect(2)`. There is no window between check and
   connect, which is what defeats DNS rebinding; the check runs for every
   connection the transport makes, redirect hops included. This layer is
   authoritative for addresses. Hostname entries are enforced by a second,
   name-level check that runs before every request (initial and each
   redirect hop, in the transport) without resolving anything; it is never
   the only defense.
2. **Deny by default.** The default deny list blocks `localhost`, loopback,
   private ranges, link-local (cloud metadata, `169.254.169.254`),
   carrier-grade NAT, benchmark, and unspecified ranges, IPv4 and IPv6
   (`httputil.DefaultDenyList`, aligned with upstream's
   `HTTPClient.DenyList`).
3. **The allow list is an exception list, not a mode.** Deny applies first,
   allow second: a target matching the allow list is permitted even when a
   deny entry covers it; everything not denied is permitted as before. Both
   lists accept hostnames (exact match), IPs, and CIDR ranges. Local
   development against loopback schema hosts is
   `httpclient.allow_list: [localhost, 127.0.0.0/8]`. Because the
   connect-time check sees only resolved addresses, a hostname allow entry
   can only counter a hostname deny entry; a denial by IP range needs an IP
   or CIDR allow entry (in the example above, `127.0.0.0/8` is the entry
   that matters at connect time). The operator-lockdown "only listed hosts
   may be fetched" mode that #928 raised as an open question is rejected;
   deny-plus-exceptions is the model.
4. **Redirects are followed but never trusted.** Hop cap
   (`max_redirects`, default 5; 0 refuses redirects), the full policy check
   repeated at every hop, and an https to http downgrade fails unless
   `allow_https_downgrade` opts in.
5. **Responses are bounded, never truncated.** `max_body_size` (default
   1 MiB) rejects an oversized body with a distinct error, both when the
   declared `Content-Length` exceeds it and when a chunked body overruns it
   mid-read. Silent truncation is forbidden: a caller that ignores limits
   must still fail loudly.
6. **Two timeouts at two granularities.** `httpclient.timeout` (default 10s)
   bounds each single request. `schema.resolve_timeout` (default 30s) is a
   context deadline over one whole schema ingest, so `$ref` depth (capped at
   10) cannot multiply the per-request timeout into sequential waits. The
   envelope lives in the schema config because only schema ingest has a
   multi-request chain. The transport additionally carries the upstream
   port's fixed dialer settings: a 5s connect timeout and 30s keep-alive.
7. **Distinct, actionable errors.** The caller chose the URL, so each
   failure mode has its own code (`sch.fetch_denied`, `sch.fetch_too_large`,
   `sch.fetch_too_many_redirects`, `sch.fetch_downgrade`,
   `sch.fetch_timeout`), all 400, with the failing URL (the submitted one or
   a nested `$ref` target) in details and the transport cause in logs.

### Configuration

One `httpclient` block (env `NEXTGEN_HTTPCLIENT_<KEY>`, lists comma
separated): `timeout`, `max_body_size`, `max_redirects`,
`allow_https_downgrade`, `deny_list`, `allow_list`. Setting `deny_list`
replaces the default list entirely; exceptions belong in `allow_list`.
Malformed entries (a bad CIDR) fail startup rather than silently becoming a
hostname entry that never matches. The policy is process-wide and never
per-tenant or per-connection (a #928 constraint).

## Consequences

- One process-wide policy serves all user-injectable egress. An allow entry
  added for one feature also applies to the others; if a future consumer
  needs a different trust level, build a second `ClientConfig` instance,
  not a second mechanism.
- `internal/httputil` imports nothing repo-specific, so promoting it to a
  shared `github.com/zitadel/...` library (also consumable by
  zitadel/zitadel) is a copy. That extraction is proposed on #928 and waits
  for a committed second consumer.
- The schema resolver's never-enforced `maxSize` parameter is deleted; the
  client's `max_body_size` is the single enforcement point (deviation from
  #1114's literal suggestion, same intent; overlaps #812's adjacent
  finding).
- Integration and local setups fetching from loopback test servers must
  allow loopback explicitly, which doubles as the documented development
  relaxation. The instance-scoped development mode remains open on #928.
