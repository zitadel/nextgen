package middleware

import (
	"net/http"

	"go.opentelemetry.io/otel/propagation"
)

// WithRemoteTraceContext continues the caller's trace: it extracts the
// incoming trace context (traceparent, tracestate and baggage, as far as
// propagator carries them) into the request context, so the server span that
// starts from that context becomes a child of the caller's span instead of a
// new root.
//
// Extraction adopts the caller's sampled flag along with its trace ID, and
// the tracer provider's sampler may honour it. Only install this where the
// callers are trusted, see ADR 068. It must run before whatever starts the
// server span.
func WithRemoteTraceContext(propagator propagation.TextMapPropagator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := propagator.Extract(r.Context(), propagation.HeaderCarrier(r.Header))
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
