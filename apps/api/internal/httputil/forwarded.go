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

// firstForwarded returns the first entry of a forwarded header that proxies
// may have appended to ("a.example, b.internal").
func firstForwarded(value string) string {
	first, _, _ := strings.Cut(value, ",")
	return strings.TrimSpace(first)
}
