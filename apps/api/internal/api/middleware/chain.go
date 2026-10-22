package middleware

import "net/http"

// Chain applies mws to h so the first listed runs outermost — first to see the
// request, last to see the response — matching the top-to-bottom reading order
// of the equivalent nested wrapping.
func Chain(h http.Handler, mws ...func(http.Handler) http.Handler) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}
