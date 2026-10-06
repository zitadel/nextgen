package api

import (
	"net/http"
	"strings"
)

const sessionStateCacheControl = "private, no-store"

// WithSessionStateNoStore prevents responses that carry session state or a
// credential from being stored: GET /sessions/me, and the flow start, step
// render and submit, which set the flow cookie and can return the single-use
// handoff token. It wraps the
// generated server so the header is also present on security and decoding
// errors emitted before the operation handler runs.
func WithSessionStateNoStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isNoStoreOperation(r.Method, r.URL.Path) {
			w.Header().Set("Cache-Control", sessionStateCacheControl)
		}
		next.ServeHTTP(w, r)
	})
}

func isNoStoreOperation(method, path string) bool {
	if method == http.MethodGet && path == "/sessions/me" {
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
