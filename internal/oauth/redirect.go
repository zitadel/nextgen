package oauth

import (
	"net"
	"net/url"
	"strings"

	"github.com/zitadel/nextgen/internal/httputil"
)

// matchRedirectURI returns the redirect URI to send the browser to when
// requested names one of registered: the same string, or, for a loopback
// registration, the same scheme, host, path and query on any port (RFC 8252
// §7.3), which is how a native app's listener gets a free port. The URI is
// parsed as any redirect target the server sends a browser to is.
func matchRedirectURI(registered []string, requested string) (*url.URL, bool) {
	target, err := httputil.ParseRedirectTarget(requested)
	if err != nil || target.Fragment != "" {
		return nil, false
	}
	for _, candidate := range registered {
		if candidate == requested {
			return target, true
		}
		want, err := url.Parse(candidate)
		if err != nil || !isLoopback(want.Hostname()) {
			continue
		}
		if target.Scheme == "http" && want.Scheme == "http" &&
			strings.EqualFold(target.Hostname(), want.Hostname()) &&
			target.EscapedPath() == want.EscapedPath() &&
			target.RawQuery == want.RawQuery {
			return target, true
		}
	}
	return nil, false
}

// isLoopback is a loopback IP literal or localhost, the hosts RFC 8252 lets a
// native app listen on.
func isLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
