package middleware

import (
	"context"
	"net/http"
)

type requestContextKey struct{}

// RequestContext carries server-authoritative correlation fields for Path A/B events.
type RequestContext struct {
	RequestID   string
	SessionID   string
	FlowID      string
	Fingerprint string
}

func WithRequestContext(ctx context.Context, rc RequestContext) context.Context {
	return context.WithValue(ctx, requestContextKey{}, rc)
}

func GetRequestContext(ctx context.Context) (RequestContext, bool) {
	v, ok := ctx.Value(requestContextKey{}).(RequestContext)
	return v, ok
}

// WithRequestContextMiddleware mints request_id, stores RequestContext, and
// echoes X-Request-Id.
func WithRequestContextMiddleware(generator RequestIDGenerator, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := generator.New("req")
		if err == nil && id != "" {
			rc := RequestContext{RequestID: id}
			ctx := WithRequestIDContext(r.Context(), id)
			ctx = WithRequestContext(ctx, rc)
			r = r.WithContext(ctx)
			w.Header().Set("X-Request-Id", id)
		}
		next.ServeHTTP(w, r)
	})
}
