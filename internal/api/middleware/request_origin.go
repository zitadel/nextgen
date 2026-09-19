package middleware

import (
	"net/http"
	"net/url"
	"strings"
)

// RequestOrigin is the browser origin a request came from: the Origin header
// or, failing that, the origin of the Referer. Lower-cased; empty for a
// request with neither (server to server, curl).
func RequestOrigin(r *http.Request) string {
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
