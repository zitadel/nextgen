# ADR 062: Egress Policy for User-Injectable URLs

> **Status:** Proposed
> **Date:** 2026-09-10
> **Context:** #1114 (schema ingest fetched caller-supplied URLs without limits), epic #928 (egress policy), advisory [GHSA-29jh-8cfq-rr8x](https://github.com/zitadel/zitadel/security/advisories/GHSA-29jh-8cfq-rr8x)
> **Builds on:** [ADR 030](030-error-model-mapping-and-reporting.md) (error mapping), the [Server-Side Fetch Policy](../design/idp/3-social-login-flow.md#server-side-fetch-policy)

## The need

The server increasingly fetches URLs that platform users author: today a
schema document and the references inside it, soon identity-provider
endpoints and tenant webhooks. Every such fetch runs from the server's own
network position, so on shared infrastructure a user-chosen URL is a
server-side request forgery surface: it can point at cloud metadata
services, private networks, or the instance itself. The same fetches are a
resource-exhaustion surface when responses are unbounded and requests carry
no deadline.

This is not hypothetical for this product family. Zitadel was bitten by
exactly this class (the advisory above): user-defined URLs in several
features were checked inconsistently, and the check that existed was
bypassable through DNS rebinding, redirects, and https-to-http downgrades.
The lesson is that per-feature checks rot; the policy has to be decided
once and owned centrally, before the second consumer exists.

## Decision

1. **One shared mechanism.** Every fetch of a URL a platform user can
   inject goes through the same hardened egress path. No feature carries
   its own address check (#928).
2. **Scope follows the threat model.** Server-side request forgery needs a
   user-controlled URL, so endpoints only the operator configures (the
   telemetry collector, the audit export sink) deliberately stay on
   ordinary clients: they commonly live on private addresses the policy
   blocks, and forcing them through it would break correct deployments to
   defend operators against themselves. The day such a target becomes
   user-configurable, it adopts the hardened path.
3. **Deny by default.** The default deny list blocks loopback, private,
   link-local (cloud metadata), carrier-grade NAT, benchmark, and
   unspecified ranges, IPv4 and IPv6, plus the localhost name, aligned
   with Zitadel's default list.
4. **Enforce on the address actually connected to.** The authoritative
   check runs at connection time, on the resolved address, because any
   check that runs earlier can be defeated by the name re-resolving
   between check and connect (DNS rebinding). Hostname entries are
   additionally matched by name before a connection is opened. No earlier
   check is ever the only defense.
5. **The allow list is an exception list, not a mode.** An allow entry
   re-permits something the deny list blocks; everything not denied stays
   allowed. The operator-lockdown "only listed hosts may be fetched" mode
   from #928's open questions is rejected. A consequence of decision 4: a
   hostname allow entry can only counter a hostname deny entry, while a
   denial by address range needs an address exception, because the
   connection-time check sees addresses, not names. Local development
   against loopback targets is an allow-list exception, never a weakened
   deny list.
6. **Redirects are followed but never trusted.** Bounded hop count, the
   full policy re-applied at every hop, and no silent downgrade from https
   to http.
7. **Bounded work, loud failures.** Responses are bounded and rejected
   when the bound is exceeded, never silently truncated. Every request
   carries a deadline, and an operation that fans out into several fetches
   (a schema and its references) carries one overall deadline on top, so
   recursion cannot multiply the per-request bound.
8. **Distinguishable, attributable failures.** Each failure mode (denied
   address, oversized response, redirect limit, downgrade, timeout) is its
   own error naming the URL that failed, and the rule that denied a fetch
   is attributable in server logs. The caller supplied the URL, so precise
   errors reveal nothing they do not already control.
9. **Operator-level, process-wide configuration.** Deny and allow lists
   and the limits are operator configuration, validated at startup (a
   malformed entry fails the boot rather than silently weakening the
   list). The policy is never configurable per tenant or per connection
   (#928 constraint).
10. **Extraction-ready.** The mechanism stays free of repo-specific
    dependencies so it can be promoted into a shared library that both
    Zitadel products consume. The extraction is proposed on #928 and waits
    for a committed second consumer.

## Consequences

- Schema ingest by URL (#1114) is the first consumer; social login (#851)
  and tenant webhooks adopt the same client when they land.
- An allow entry added for one feature applies to every consumer of the
  shared policy. A future consumer needing a different trust level gets
  its own configured instance of the same mechanism, not a second
  mechanism.
- Concrete defaults (list entries, size and time limits, redirect cap)
  live with the operator configuration reference, not here, so they can be
  tuned without amending this decision.
- Development and test setups fetching from loopback must allow it
  explicitly; that is the supported relaxation. The instance-scoped
  development mode remains open on #928.
