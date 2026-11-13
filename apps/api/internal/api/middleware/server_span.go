package middleware

import (
	"context"
	"net/http"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.39.0"
	"go.opentelemetry.io/otel/trace"
)

const serverSpanScope = "github.com/zitadel/nextgen/internal/api/middleware"

var serverSpanKind = trace.WithSpanKind(trace.SpanKindServer)

type serverSpanKey struct{}

// WithServerSpan starts the server span of every request and ends it when the
// handler returns, so it goes in front of every mount and of all their
// middleware: one request, one server span, whatever answers it. It runs
// after [WithRemoteTraceContext], whose context the span starts from.
//
// The span starts with the method for a name and no http.route: at the edge
// nothing knows what the path matches, and a raw path is the caller's text,
// of any cardinality. What answers the request names it: an API operation
// through the ogen tracer, a handler of its own through [ServerSpan]. A
// request nothing names, a path the API lacks or a method its path does not
// take, keeps the method.
//
// The status code goes on the span when the handler returns. A 5xx, and a
// handler that panicked, set the status to Error; a 4xx leaves it unset, as
// the HTTP conventions ask of a server.
//
// A request the sampler drops pays for the start and nothing after it.
func WithServerSpan(provider trace.TracerProvider) func(http.Handler) http.Handler {
	tracer := provider.Tracer(serverSpanScope)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			method, name := requestMethod(r.Method)
			ctx, span := tracer.Start(r.Context(), name, serverSpanKind)
			defer span.End()
			r = r.WithContext(context.WithValue(ctx, serverSpanKey{}, span))
			if !span.IsRecording() {
				next.ServeHTTP(w, r)
				return
			}
			span.SetAttributes(method)
			rw := &loggingResponseWriter{ResponseWriter: w}
			returned := false
			// Deferred without recover: a panic keeps propagating and the
			// span still says what the client saw.
			defer func() {
				status := rw.statusCode
				if status == 0 && returned {
					status = http.StatusOK
				}
				if status != 0 {
					span.SetAttributes(semconv.HTTPResponseStatusCode(status))
				}
				if status >= http.StatusInternalServerError || !returned {
					span.SetStatus(codes.Error, "")
				}
			}()
			next.ServeHTTP(rw, r)
			returned = true
		})
	}
}

// ServerSpan returns the server span [WithServerSpan] started for the request
// of ctx, for the handler that answers the request to name and describe. It
// reports false when the request did not pass WithServerSpan.
func ServerSpan(ctx context.Context) (trace.Span, bool) {
	span, ok := ctx.Value(serverSpanKey{}).(trace.Span)
	return span, ok
}

// requestMethod returns the http.request.method of method, and the name of a
// span that has no route to put after it. net/http takes any token for a
// method, so one the conventions do not list is _OTHER, and its span "HTTP".
func requestMethod(method string) (attribute.KeyValue, string) {
	switch method {
	case http.MethodConnect, http.MethodDelete, http.MethodGet, http.MethodHead, http.MethodOptions,
		http.MethodPatch, http.MethodPost, http.MethodPut, http.MethodTrace, "QUERY":
		return semconv.HTTPRequestMethodKey.String(method), method
	}
	return semconv.HTTPRequestMethodOther, "HTTP"
}
