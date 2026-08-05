package api

import "net/http"

const sessionStateCacheControl = "private, no-store"

// WithSessionStateNoStore prevents any GET /sessions/me response from being
// stored. It wraps the generated server so the header is also present on
// security and decoding errors emitted before the operation handler runs.
func WithSessionStateNoStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/sessions/me" {
			w.Header().Set("Cache-Control", sessionStateCacheControl)
		}
		next.ServeHTTP(w, r)
	})
}
