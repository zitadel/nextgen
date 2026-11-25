package httputil

import (
	"net/http"
	"strings"
)

// ProxyPrefix is the path prefix under which a scaffolded app's SDK proxy
// forwards requests to this server, and the prefix it strips on the way. A
// request that arrives through it carries the prefix in X-Forwarded-Prefix.
const ProxyPrefix = "/__nextgen"

// ForwardedOrigin returns the origin the client's request arrived at,
// as "proto://host": the first X-Forwarded-Proto, else https when the
// connection has TLS and http otherwise, and the first X-Forwarded-Host,
// else the request's Host. A chain of proxies may send either forwarded
// header as a comma-separated list; its first entry is the one the
// client's request arrived with. It returns "" when no host is known.
func ForwardedOrigin(r *http.Request) string {
	proto := firstForwarded(r.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		proto = "http"
		if r.TLS != nil {
			proto = "https"
		}
	}
	host := firstForwarded(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = r.Host
	}
	if host == "" {
		return ""
	}
	return proto + "://" + host
}

// forwardedVary names the forwarded headers a response built from
// [ForwardedOrigin] and the forwarded prefix depends on.
const forwardedVary = "X-Forwarded-Host, X-Forwarded-Proto, X-Forwarded-Prefix"

// WithForwardedNoStore marks every response of next as uncacheable by a
// shared cache and as varying with the forwarded headers, for a handler
// whose answer depends on the origin or prefix the client's request arrived
// with. A cache in front of the server then never hands one origin's answer
// to another. It covers error responses too: a request refused at one
// origin may be answered at the next. It adds to Vary rather than replacing
// it, so a value another middleware set, such as CORS's Origin, stays.
func WithForwardedNoStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Add("Vary", forwardedVary)
		next.ServeHTTP(w, r)
	})
}

// firstForwarded returns the first entry of a forwarded header that proxies
// may have appended to ("a.example, b.internal").
func firstForwarded(value string) string {
	first, _, _ := strings.Cut(value, ",")
	return strings.TrimSpace(first)
}
