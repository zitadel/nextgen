// Where the server's telemetry goes. There is one sink at a time:
//
// - Vercel, unless the environment says otherwise: the wrapper collects the
//   server's spans and metrics and hands them to Vercel Tracing and Vercel's
//   custom metrics, and the logs are Vercel's runtime logs.
// - an OTLP backend, when OTEL_EXPORTER_OTLP_ENDPOINT names one (with
//   OTEL_EXPORTER_OTLP_HEADERS for its credentials): the launcher then points
//   the server's spans, metrics and logs at it, and the wrapper only forwards
//   requests and relays the log lines.
//
// Never both: a second copy is forwarded from the sink (a Vercel Drain takes
// logs and traces), not exported twice from the function.

/** Whether Vercel is the sink for this environment. */
export function sendsToVercel(env) {
  return !env.OTEL_EXPORTER_OTLP_ENDPOINT;
}
