package middleware

import (
	"context"
)

// RequestIDGenerator mints correlation ids for HTTP requests (not resource PKs).
type RequestIDGenerator interface {
	New(prefix string) (string, error)
}

type requestID struct{}

func WithRequestIDContext(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestID{}, id)
}

func GetRequestIDContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(requestID{}).(string)
	return v, ok
}
