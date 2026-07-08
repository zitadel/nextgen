# ADR 031: Abuse Prevention and Operational Resiliency

> **Status:** Proposed
> **Date:** 2026-07-08
> **Context:** Rate limiting, brute-force protection, bot escalation, and auth-flow consistency

## Context

Epic 249 requires the nextgen platform to define abuse prevention and
operational resiliency before implementation. The current POC has auth-attempt
state and CAPTCHA design surfaces, but no cohesive policy for rate limits or 
bruteforce mitigation.

See also:

- [ADR 010](010-session-auth-attempt-check-model.md) — auth attempts, checks,
  and per-check `failure_count`
- [ADR 019](019-captcha-gate-and-bot-signals.md) — CAPTCHA gate and trusted
  edge bot-signal contract

## Current State Inventory

- No request, project, user, IP, or endpoint throttle is enforced today.
- Failed proofs increment `checks.failure_count` / `last_failed_at` on the
  current auth-attempt challenge. This is a local signal, not lockout policy.
- Credential-level `failed_attempts` fields exist for password, TOTP, and
  recovery codes, but failed login verification does not use them.
- CAPTCHA and trusted bot-signal contracts exist, but runtime enforcement is
  not wired yet.

## Decision

### Rate-Limiting Placement

Nextgen starts with **edge-level request rate limiting**, following the current
Zitadel Cloud pattern. Deployments should enforce coarse limits before requests
reach the Go service, at the deployment edge.

Nextgen does not require a built-in distributed limiter in the codebase.
Zitadel Cloud has not seen overload from request volume as a primary problem so
far. Nextgen also uses Spanner or relational Postgres storage instead of the
old event-sourced database model, which should improve database behavior for
these paths. Service-level limits are deferred until there is a concrete abuse
case that requires application semantics.

The nextgen **Cloud service** starts with the same edge limits as the legacy
Zitadel Cloud service, enforced through Cloud Armor on the global load balancer.
Self-hosted deployments are out of scope here and may enforce limits on their
own load balancer. The default rule throttles everything by source IP to
3000 req / 60s, banning at 9000 req / 180s for 60s.

### Distributed Limits

If service-level distributed limits are needed later, they can be retrofitted
with Redis/Valkey or Postgres-backed counters without changing the edge-first
decision. Edge limits remain relevant as the first layer for broad traffic
protection.

Self-hosting customers can also enforce it on their load balancer.
For example, `mholt/caddy-ratelimit` provides distributed HTTP rate limiting for Caddy:
<https://github.com/mholt/caddy-ratelimit>.

### Brute-Force Mitigation

Nextgen stores durable failed-attempt state per user credential/factor
and uses that state consistently across auth attempts.

Proof verification updates the credential/factor counter in the same logical
operation as the verification result. A failed proof increments the counter and
records the failure time. A successful proof resets the counter for that proof
type and records the successful verification time.

The credential/factor counter drives progressive controls:

- after each failed proof, calculate an exponential backoff delay from the
  current failure count, bounded by the fixed initial maximum delay

The initial backoff defaults are fixed service behavior, not customer-facing
configuration:

- failures 1-4: no artificial delay
- failure 5: 10 second delay
- each later failure doubles the delay, capped at 5 minutes

These defaults can become instance or project settings later if operational
data shows that customers need different thresholds.

CAPTCHA remains a configurable flow/risk gate as defined in ADR 019, not a
mandatory consequence of the built-in brute-force policy.

### Database Consistency

Database replication lag is not expected to affect Spanner because
auth-critical reads use Spanner's default strong consistency.

For PostgreSQL, security-critical authentication reads must use the
primary/write path unless the deployment explicitly provides read-after-write
consistency. Read replicas may be used only for non-critical reads.

For Google Cloud SQL PostgreSQL, auth decisions use the primary instance
endpoint. HA failover keeps that endpoint pointing at the current primary. Read
replicas are separate read targets and can lag, so they must not serve auth
decisions.

## Consequences

Auth-critical storage calls must remain on a consistency-safe database path.
Future read-splitting or replica routing must not apply to authentication
decisions by default.

Self-hosted deployments must provide their own edge or load-balancer rate
limiting outside of nextgen if they need request-volume protection.

Bot protection through CAPTCHA is only applied when configured explicitly in
the relevant flows.
