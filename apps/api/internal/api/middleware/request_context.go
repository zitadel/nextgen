package middleware

import (
	"context"
	"net/http"
	"regexp"
	"strings"
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

// WithRequestContextMiddleware gives the request its request_id, stores
// RequestContext, and echoes X-Request-Id.
//
// The ID is minted, unless idHeader names a header that a proxy in front of
// the server sets to its own ID for the request and the request carries a
// usable one: then the server's logs, events and error pages quote the ID the
// proxy's logs show (Vercel's on the hosted cloud, ADR 076). Name a header
// only behind a proxy that overwrites it, or a client chooses its own ID.
func WithRequestContextMiddleware(generator RequestIDGenerator, idHeader string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := proxyRequestID(r, idHeader)
		if id == "" {
			if minted, err := generator.New("req"); err == nil {
				id = minted
			}
		}
		if id != "" {
			rc := RequestContext{RequestID: id}
			ctx := WithRequestIDContext(r.Context(), id)
			ctx = WithRequestContext(ctx, rc)
			r = r.WithContext(ctx)
			w.Header().Set("X-Request-Id", id)
		}
		next.ServeHTTP(w, r)
	})
}

// proxyRequestIDPattern is what a proxy's request ID may hold to be used: an
// opaque token that is safe to log and to print, never free text.
var proxyRequestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

// proxyRequestID is the request's ID from header, or "" when it has none to
// use. A value that lists the hops before the ID, as Vercel's x-vercel-id does
// (sfo1::fra1::2vxlh-1792820352212-3ce3eb4ad630), gives the part after its
// last "::", the ID Vercel's dashboard shows.
func proxyRequestID(r *http.Request, header string) string {
	if header == "" {
		return ""
	}
	value := r.Header.Get(header)
	if i := strings.LastIndex(value, "::"); i >= 0 {
		value = value[i+len("::"):]
	}
	if !proxyRequestIDPattern.MatchString(value) {
		return ""
	}
	return value
}
