package middleware

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

type requestOriginKey struct{}

// WithRequestOriginMiddleware makes the browser origin a request came from
// available to handlers via RequestOriginFromContext: the Origin header or,
// failing that, the origin of the Referer. Lower-cased; a request with
// neither (server to server, curl) carries no origin.
func WithRequestOriginMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := requestOrigin(r); origin != "" {
			r = r.WithContext(context.WithValue(r.Context(), requestOriginKey{}, origin))
		}
		next.ServeHTTP(w, r)
	})
}

// RequestOriginFromContext returns the origin injected by
// WithRequestOriginMiddleware.
func RequestOriginFromContext(ctx context.Context) (string, bool) {
	origin, ok := ctx.Value(requestOriginKey{}).(string)
	return origin, ok && origin != ""
}

func requestOrigin(r *http.Request) string {
	if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" && origin != "null" {
		return strings.ToLower(origin)
	}
	referer := strings.TrimSpace(r.Header.Get("Referer"))
	if referer == "" {
		return ""
	}
	u, err := url.Parse(referer)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return strings.ToLower(u.Scheme + "://" + u.Host)
}
