package middleware

import (
	"context"

	"github.com/ogen-go/ogen/middleware"
	oasapi "github.com/zitadel/nextgen/api/generated"
)

type operationIDContextKey struct {
}

type operationIDWrapper struct {
	operationID string
}

func AddOperationIdToContext() oasapi.Middleware {
	return func(req middleware.Request, next middleware.Next) (middleware.Response, error) {
		req.SetContext(WithOperationIDContext(req.Context, req.OperationID))
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
