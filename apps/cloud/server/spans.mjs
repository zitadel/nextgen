// Sorts the server's exported spans by request. The wrapper opens an entry for
// each traced request under the trace ID and parent span it sends the server
// in traceparent; the server's spans for that request carry the trace ID, and
// its server span has that parent. The server batches spans from concurrent
// requests together, so every export is split by trace ID. Spans whose trace
// has no open entry (a request Vercel did not sample, work that outlives its
// request, a background job) have nowhere to be reported and are counted.

export class SpanRouter {
  #open = new Map();
  unmatched = 0;

  /**
   * Opens an entry for a request. Returns null when a request with the same
   * trace ID is already open: Vercel keeps a client's trace ID, so two
   * requests can share one, and the first takes the spans of both.
   */
  open(traceId, parentSpanId) {
    if (this.#open.has(traceId)) {
      return null;
    }
    const entry = { traceId, parentSpanId, fragments: [], serverSpanEnded: false, notify: null };
    this.#open.set(traceId, entry);
    return entry;
  }

  /** Files the spans of one export (OTLP JSON) under their requests. */
  ingest(request) {
    for (const rs of request.resourceSpans ?? []) {
      for (const ss of rs.scopeSpans ?? []) {
        const byTrace = new Map();
        for (const span of ss.spans ?? []) {
          const spans = byTrace.get(span.traceId) ?? [];
          spans.push(span);
          byTrace.set(span.traceId, spans);
        }
        for (const [traceId, spans] of byTrace) {
          const entry = this.#open.get(traceId);
          if (!entry) {
            this.unmatched += spans.length;
            continue;
          }
          entry.fragments.push({ resource: rs.resource, scope: ss.scope, spans });
          if (spans.some((span) => span.parentSpanId === entry.parentSpanId)) {
            entry.serverSpanEnded = true;
            entry.notify?.();
          }
        }
      }
    }
  }

  /**
   * Closes an entry once its server span has arrived, or after waitMs, and
   * returns its spans as one OTLP JSON request, or null when none arrived.
   */
  async close(entry, waitMs) {
    if (!entry.serverSpanEnded) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, waitMs);
        entry.notify = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    this.#open.delete(entry.traceId);
    if (entry.fragments.length === 0) {
      return null;
    }
    return {
      resourceSpans: entry.fragments.map((fragment) => ({
        resource: fragment.resource,
        scopeSpans: [{ scope: fragment.scope, spans: fragment.spans }],
      })),
    };
  }

  get openCount() {
    return this.#open.size;
  }
}
