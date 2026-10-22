package middleware

import (
	"context"

	"github.com/ogen-go/ogen/middleware"
	"go.opentelemetry.io/otel/trace"

	oasapi "github.com/zitadel/nextgen/api/generated"
)

type operationIDContextKey struct {
}

type operationIDWrapper struct {
	operationID string
	// serverSpan is the span context of the server span the ogen tracer or
	// the IdP callback handler started, which the net/http middleware outside
	// of it cannot see otherwise.
	serverSpan trace.SpanContext
}

// AddOperationIdToContext fills the holder with the operation ID.
func AddOperationIdToContext() oasapi.Middleware {
	return func(req middleware.Request, next middleware.Next) (middleware.Response, error) {
		req.SetContext(WithOperationIDContext(req.Context, req.OperationID))
		return next(req)
	}
}

// SetServerSpanContext stores the span context of the server span in the
// holder [WithLogging] put on ctx. The ogen tracer calls it when it starts
// that span, before security and decoding run, so a request that fails there
// is still linked to it. The IdP callback handler calls it for its own span.
// Without a holder it does nothing.
func SetServerSpanContext(ctx context.Context, sc trace.SpanContext) {
	if wrapper, ok := ctx.Value(operationIDContextKey{}).(*operationIDWrapper); ok {
		wrapper.serverSpan = sc
	}
}

// WithOperationIDContext adds the given operation ID to the given context.
// The value is wrapped in struct so that it can be set downstream and
// retrieved upstream in the callstack.
// If a wrapper already exists in the context, its value is set instead of
// creating a new wrapper.
func WithOperationIDContext(ctx context.Context, operationID string) context.Context {
	wrapper, ok := ctx.Value(operationIDContextKey{}).(*operationIDWrapper)
	if ok {
		wrapper.operationID = operationID
		return ctx
	}

	return context.WithValue(ctx, operationIDContextKey{}, &operationIDWrapper{operationID: operationID})
}

func GetOperationIDContext(ctx context.Context) (string, bool) {
	wrapper, ok := ctx.Value(operationIDContextKey{}).(*operationIDWrapper)
	if !ok {
		return "", false
	}
	return wrapper.operationID, true
}

// GetServerSpanContext returns the span context of the server span that the
// ogen tracer or the IdP callback handler stored, or an invalid one when none
// ran.
func GetServerSpanContext(ctx context.Context) trace.SpanContext {
	wrapper, ok := ctx.Value(operationIDContextKey{}).(*operationIDWrapper)
	if !ok {
		return trace.SpanContext{}
	}
	return wrapper.serverSpan
}
