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
// §7.3), which is how a native app's listener gets a free port.
//
// requested is the parameter as the request's form or query decoded it, once.
// It is parsed as it stands and never decoded again, as any redirect target
// the server sends a browser to is, and it must already be its own canonical
// form: so the URL checked here is, byte for byte, the URL the browser is sent
// to. A validator that decodes twice and redirects to the once-decoded value
// lets `http://127.0.0.1%2Fcallback%23@attacker.example/` pass as
// `http://127.0.0.1/callback#@attacker.example/` while the browser goes to
// attacker.example; Zitadel v4 lost codes that way. A fragment is refused
// outright, an empty one too (RFC 6749 §3.1.2).
func matchRedirectURI(registered []string, requested string) (*url.URL, bool) {
	if strings.Contains(requested, "#") {
		return nil, false
	}
	target, err := httputil.ParseRedirectTarget(requested)
	if err != nil || target.String() != requested {
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
		// Every part but the port as the registration spells it: the host as
		// the same literal (no decimal or other spelling of 127.0.0.1), and
		// the path and query still escaped.
		if target.Scheme == "http" && want.Scheme == "http" &&
			target.Hostname() == want.Hostname() &&
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
