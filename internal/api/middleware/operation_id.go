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
	// serverSpan is the span context of the ogen server span, which the
	// net/http middleware outside of it cannot see otherwise.
	serverSpan trace.SpanContext
}

// AddOperationIdToContext fills the holder with the operation ID and the
// server span context. It runs inside the server span.
func AddOperationIdToContext() oasapi.Middleware {
	return func(req middleware.Request, next middleware.Next) (middleware.Response, error) {
		ctx := WithOperationIDContext(req.Context, req.OperationID)
		ctx.Value(operationIDContextKey{}).(*operationIDWrapper).serverSpan = trace.SpanContextFromContext(ctx)
		req.SetContext(ctx)
		return next(req)
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

// GetServerSpanContext returns the span context of the ogen server span that
// handled the request, or an invalid one when it never ran.
func GetServerSpanContext(ctx context.Context) trace.SpanContext {
	wrapper, ok := ctx.Value(operationIDContextKey{}).(*operationIDWrapper)
	if !ok {
		return trace.SpanContext{}
	}
	return wrapper.serverSpan
}
