package middleware

import (
	"context"
	"net"
	"net/http"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
)

type userAgentKey struct{}

// WithUserAgentMiddleware makes the request's User-Agent header and client IP
// available to handlers via UserAgentFromContext.
func WithUserAgentMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ua := userAgentFromRequest(r); ua != nil {
			r = r.WithContext(context.WithValue(r.Context(), userAgentKey{}, ua))
		}
		next.ServeHTTP(w, r)
	})
}

// UserAgentFromContext returns the device context injected by WithUserAgentMiddleware.
func UserAgentFromContext(ctx context.Context) (*domain.UserAgent, bool) {
	ua, ok := ctx.Value(userAgentKey{}).(*domain.UserAgent)
	return ua, ok && ua != nil
}

func userAgentFromRequest(r *http.Request) *domain.UserAgent {
	ip := clientIP(r)
	header := r.UserAgent()
	if ip == "" && header == "" {
		return nil
	}
	ua := &domain.UserAgent{IP: ip}
	if header != "" {
		ua.Info = map[string]any{"user_agent": header}
	}
	return ua
}

// clientIP is the first valid hop of X-Forwarded-For when set (the proxy is
// trusted, as for X-Forwarded-Host), else RemoteAddr without its port.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		first, _, _ := strings.Cut(xff, ",")
		if ip := strings.TrimSpace(first); net.ParseIP(ip) != nil {
			return ip
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
