# ADR 068: Incoming Trace Context Is Ignored Unless `trust_remote_spans` Is On

> **Status:** Proposed
> **Date:** 2026-10-06
> **Context:** [#1390](https://github.com/zitadel/nextgen/issues/1390), found while planning [#1098](https://github.com/zitadel/nextgen/issues/1098) under the instrumentation epic [#1094](https://github.com/zitadel/nextgen/issues/1094)
> **Related:** `internal/instrumentation/zotel/tracing.go` (the sampler), [Configuration](../quick-start/configuration.md#tracing)

## Context

When another service calls ZITADEL as part of its own trace, ZITADEL used to
ignore the caller's `traceparent` and start a new trace. The W3C propagator is
installed globally, but nothing called `Extract` on an incoming request, and
the generated ogen server starts its server span from `r.Context()`. Every
request was a new root. The setting meant to control this,
`instrumentation.trace.trust_remote_spans`, existed in `TraceConfig` and was
never read.

Continuing the caller's trace is not free of risk, because extraction adopts
the caller's **sampled flag** together with its trace ID. The sampler is
`ParentBased`:

| Parent                  | Sampler today                                            |
| ----------------------- | -------------------------------------------------------- |
| none (a new root)       | `TraceIDRatioBased(fraction)`, server spans only         |
| remote, sampled         | always sample (the `ParentBased` default)                |
| remote, not sampled     | `TraceIDRatioBased(fraction)` (`WithRemoteParentNotSampled`) |
| local, sampled / not    | follow the parent (the `ParentBased` default)            |

So a trusted caller that sends the sampled flag gets its request recorded and
exported whatever `instrumentation.trace.fraction` says, and so does every
local child span below it. On a public endpoint anyone can send that header,
which would let an anonymous caller spend our CPU and exporter traffic.

Options considered in the issue:

1. Never trust incoming context, and delete the setting.
2. Trust it only when `trust_remote_spans` is on, off by default.
3. Always continue the caller's trace ID, but apply our own sampling ratio
   instead of the caller's flag.

## Decision

**Option 2.** `instrumentation.trace.trust_remote_spans` decides, and it
defaults to **off**.

- **Off (default).** The incoming `traceparent`, `tracestate` and `baggage`
  headers are not used. The server span is a new root with a new trace ID,
  sampled by `instrumentation.trace.fraction`. This is the behavior before this
  ADR.
- **On.** HTTP middleware extracts the context with the global propagator
  ahead of everything else in the server, so the request logs and the server
  span both see it. The server span becomes a child of the caller's span and
  joins the caller's trace ID. `tracestate` and `baggage` are carried too.
  A missing or malformed `traceparent` is a new root, as when off.

### What trusting means for sampling

Trusting the caller's context means trusting its sampled flag, and the sampler
is unchanged:

- A caller that sends `sampled=1` is **always** recorded and exported, and so
  are the local child spans. `fraction` does not apply to it.
- A caller that sends `sampled=0` is still sampled by `fraction`, so we can
  sample requests a caller would drop.
- A request without a trace context is sampled by `fraction`.

The setting is therefore meant for ZITADEL behind a proxy, gateway or mesh
that the operator controls and that strips or overwrites these headers at the
edge. It must stay off when ZITADEL is reachable directly by untrusted
callers.

### Why not the other options

- **Never trust** leaves callers unable to follow a request into ZITADEL, even
  in a deployment where the whole path is trusted. The setting already exists
  and costs a middleware to honor.
- **Always continue, own ratio** is a one-line sampler change
  (`WithRemoteParentSampled(fraction)`) and would take the cost risk away, but
  it still lets any anonymous caller choose the trace ID and `tracestate` we
  record, and it samples a continued trace independently of the caller's
  decision, which can leave a caller's sampled trace with a hole where we
  dropped our span. It is compatible with this decision and is the natural
  follow-up if operators ask to continue traces from untrusted callers.

## Consequences

- The default does not change. Nothing happens to deployments that do not set
  `trust_remote_spans`.
- Turning the setting on is an explicit operator decision about the network in
  front of ZITADEL; the setting's documentation says so.
- `baggage` is extracted too when trusted. Nothing in the server reads it
  today, and the propagator caps its size.
- The decision is covered by a test that sends a `traceparent` through the
  real tracer provider and sampler in both states and asserts the span's trace
  ID and parent.
