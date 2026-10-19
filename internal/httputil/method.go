package httputil

import (
	"net/http"
	"strings"
)

// IsSafeMethod reports whether method is treated as one that never changes
// state and so needs no CSRF protection: GET, HEAD and OPTIONS, in any case.
// TRACE, which RFC 9110 §9.2.1 also calls safe, is served by nothing here and
// stays checked. The server's CSRF check and the OpenAPI error generator share
// it, so the requests that are checked and the operations whose errors declare
// the refusal cannot drift apart. The browser client keeps its own copy
// (SAFE_METHODS in packages/api/src/runtime/fetch.ts).
func IsSafeMethod(method string) bool {
	switch strings.ToUpper(method) {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	default:
		return false
	}
}
