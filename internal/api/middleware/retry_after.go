package middleware

import (
	"net/http"
	"strconv"
)

// retryAfterSeconds is what a 429 tells the client to wait when the handler
// said nothing: the hashing limiter's queue drains within its one second
// wait, so the next request stands a fair chance after as long again.
const retryAfterSeconds = 1

// WithRetryAfter adds Retry-After to a 429 that lacks one. A handler answers
// through the generated API, where no ResponseWriter reaches the code that
// picks the status, so the header is set here on the way out instead.
func WithRetryAfter(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(&retryAfterResponseWriter{ResponseWriter: w}, r)
	})
}

type retryAfterResponseWriter struct {
	http.ResponseWriter
}

func (w *retryAfterResponseWriter) WriteHeader(code int) {
	if code == http.StatusTooManyRequests && w.Header().Get("Retry-After") == "" {
		w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds))
	}
	w.ResponseWriter.WriteHeader(code)
}

// Unwrap lets http.ResponseController reach the writer underneath, so the
// wrapper costs a handler none of its flushing or hijacking.
func (w *retryAfterResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

// Flush is kept as a method too: a wrapper further in asserts http.Flusher
// directly rather than through Unwrap, and would otherwise drop the flush.
func (w *retryAfterResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
