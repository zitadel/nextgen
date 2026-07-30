package middleware

import (
	"context"
	"log/slog"
	"net/http"

	slogctx "github.com/veqryn/slog-context"
)

// RequestIDGenerator mints correlation ids for HTTP requests (not resource PKs).
type RequestIDGenerator interface {
	New(prefix string) (string, error)
}

func WithRequestIdentification(generator RequestIDGenerator, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := generator.New("req")
		if err != nil {
			slog.Error("failed to create request id", slogctx.Err(err))
		} else {
			r = r.WithContext(WithRequestIDContext(r.Context(), id))
		}
		next.ServeHTTP(w, r)
	})
}

type requestID struct {
}

func WithRequestIDContext(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestID{}, id)
}

func GetRequestIDContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(requestID{}).(string)
	return v, ok
}
