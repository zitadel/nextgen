# Observability on Vercel, 2026-10-10

> **Status:** the logs part is done, traces wait for the team's choice of a
> backend ([decision C44](decisions.md#c44)). What Vercel's logs, traces and
> drains do for a Go server in a container, what ours does, and what to change.
> Vercel facts as read on 2026-10-10, sources at the end.

## What Vercel gives a container

- **Logs.** Vercel shows everything the server prints, but for a container it
  cannot tell which request a line belongs to: each line is attached to every
  request in flight on the instance, and per-request correlation has to come
  from our own code. The level comes from the stream, stdout as info and
  stderr as error, not from a level field in the line. Search covers the
  message and the request path. Limits: 256 lines per request, 256 KB per
  line, 1 MB per request. Retention is one day on Pro, 30 days with
  Observability Plus ($1.20 per million events; on by default for teams that
  became paid Pro after 2026-04-03).
- **Traces.** Vercel traces its own part of a request (the edge, the hand-off
  to the function). Spans from inside an application reach Vercel's trace
  view and its trace drains only through `@vercel/otel`, a Node package; a
  manual OpenTelemetry setup cannot use them. For Go and containers the docs
  say nothing, and no endpoint for our own spans is documented. Always-on
  tracing (beta) costs $0.50 per million span units, one day of retention on
  Pro.
- **Drains** forward logs (JSON or NDJSON) and Vercel's traces (OTLP over
  HTTP) to an HTTPS endpoint or an integration (Datadog, Grafana, Honeycomb,
  Dash0 and others), $0.50 per GB. A drained log record carries Vercel's
  request id, trace id and span id.
- **Reading them:** `vercel logs` (search, `--json`), `vercel traces search`,
  `vercel metrics` (Observability Plus), and the same through Vercel's MCP
  tools.

## What our server did, and does now

- It wrote every log line to **stderr**, so Vercel showed every line as an
  error. Now `instrumentation.log.output: split` sends errors to stderr and
  the rest to stdout; the default stays `stderr` for self-hosters, and the
  launcher picks `split` and JSON on Vercel. The control plane logs the same
  way.
- It mints its own `request_id` per request and returns it as
  `X-Request-Id`. Now `instrumentation.log.request_headers: [x-vercel-id]`,
  set by the launcher on Vercel, also puts Vercel's request id on the
  request's lines as `x_vercel_id`: on the lines of the request log, which
  carry the `request_id` every other line of the request has. The server
  refuses to start if `request_headers` names a header that may carry a
  secret (`Authorization`, `Cookie`, a token, key, CSRF or bypass header),
  so the setting can only put ids such as `x-vercel-id` on the lines.
- It creates **no trace spans**. The tracer provider and the exporters
  (OTLP, Google Cloud, or the standard `OTEL_*` variables) exist, but nothing
  starts a span, and the incoming trace context is not read
  (`instrumentation.trace.trust_remote_spans` is unused).
- The launcher stamps region, deployment, environment and role on the
  OpenTelemetry resource, which helps once anything is exported.

## What to change

1. **Logs that read right in Vercel.** Done on 2026-10-10, as above: errors
   on their own stream, and Vercel's request id on the request's lines, so a
   line is found from the request in Vercel's log view and in a drain.
2. **Retention.** One day is enough for the MVP. Check whether the team
   already has Observability Plus before paying for anything else.
3. **Traces in a backend of our own**, with the backend choice (one to two
   days): spans for HTTP requests and database calls in the server, exported
   over OTLP to the chosen tool, and a trace drain sending Vercel's own
   request spans to the same place. As documented the two do not join into
   one trace; the ids on the log lines connect them. This helps on any
   hosting, not only on Vercel.
4. **Optional, fifteen minutes:** check on a preview whether a container
   receives a `traceparent` header or `VERCEL_OTEL_ENDPOINTS` anyway. Only
   worth it if Vercel's own trace view should show our spans; nothing
   documented promises it.

## Sources

- Container runtime: https://vercel.com/docs/functions/runtimes/container
- Runtime logs: https://vercel.com/docs/logs/runtime
- Tracing and instrumentation: https://vercel.com/docs/tracing,
  https://vercel.com/docs/tracing/instrumentation,
  https://vercel.com/docs/tracing/always-on-tracing
- Drains: https://vercel.com/docs/drains,
  https://vercel.com/docs/drains/reference/logs
- Observability Plus: https://vercel.com/docs/observability/observability-plus
- CLI: https://vercel.com/docs/cli/traces
