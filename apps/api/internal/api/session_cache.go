package api

import (
	"net/http"
	"strings"

	"github.com/zitadel/nextgen/api/client"
)

const sessionStateCacheControl = "private, no-store"

// WithSessionStateNoStore prevents responses that carry session state or a
// credential from being stored: GET /sessions/me and GET /sessions/me/csrf, and
// the flow start, step render and submit, which set the flow cookie and can
// return the single-use handoff token. It wraps the generated server so the
// header is also present on security and decoding errors emitted before the
// operation handler runs. It runs ahead of the generated server, so it reads
// the path before the server cuts client.PathPrefix: the API answers under it
// and, until 1.0.0, at the root (ADR 077), and both spellings match.
// TestWithSessionStateNoStoreCoversTheSpec keeps the GET paths in step with
// the OpenAPI source.
func WithSessionStateNoStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isNoStoreOperation(r.Method, r.URL.Path) {
			w.Header().Set("Cache-Control", sessionStateCacheControl)
		}
		next.ServeHTTP(w, r)
	})
}

func isNoStoreOperation(method, path string) bool {
	if rest, ok := strings.CutPrefix(path, client.PathPrefix); ok && strings.HasPrefix(rest, "/") {
		path = rest
	}
	if method == http.MethodGet && (path == "/sessions/me" || path == "/sessions/me/csrf") {
		return true
	}
	// Flow start shares the step response, and with it the documented header.
	if method == http.MethodPost && path == "/flow" {
		return true
	}
	rest, ok := strings.CutPrefix(path, "/flow/")
	if !ok || rest == "" {
		return false
	}
	id, sub, nested := strings.Cut(rest, "/")
	if id == "" {
		return false
	}
	switch {
	case method == http.MethodGet && !nested:
		return true
	case method == http.MethodPost && nested && sub == "submit":
		return true
	}
	return false
}
