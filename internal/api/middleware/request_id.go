package middleware

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/zitadel/nextgen/internal/domain/idgen"
)

func WithRequestIdentification(generator idgen.Generator, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := generator.New("req")
		if err != nil {
			slog.Error("failed to create request id", slog.Any("error", err))
		} else {
			r = r.WithContext(WithRequestIDContext(r.Context(), id))
		}
		next.ServeHTTP(w, r)
	})
}

type requestID struct {
}

func WithRequestIDContext(ctx context.Context, traceID string) context.Context {
	return context.WithValue(ctx, requestID{}, traceID)
}

func GetRequestIDContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(requestID{}).(string)
	return v, ok
}
