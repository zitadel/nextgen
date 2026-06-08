package middleware

import (
	"context"
	"log/slog"

	"github.com/ogen-go/ogen/middleware"
	"github.com/zitadel/nextgen/internal/domain/idgen"
)

func TraceID(generator idgen.Generator) middleware.Middleware {
	return func(req middleware.Request, next middleware.Next) (middleware.Response, error) {
		id, err := generator.New("trace")
		if err != nil {
			slog.Error("failed to create trace id", slog.Any("error", err))
			return next(req)
		}

		req.SetContext(WithTraceID(req.Context, id))
		return next(req)
	}
}

type traceContextKey struct {
}

func WithTraceID(ctx context.Context, traceID string) context.Context {
	return context.WithValue(ctx, traceContextKey{}, traceID)
}

func GetTraceID(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(traceContextKey{}).(string)
	return v, ok
}
