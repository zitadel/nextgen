package middleware

import (
	"net/http"
	"strconv"
	"time"
)

// MinRetryAfter is the least a 429 tells the client to wait: Retry-After
// counts whole seconds, and a wait of nothing would invite the retry that
// was just refused.
const MinRetryAfter = time.Second

// WithRetryAfter adds Retry-After to a 429 that lacks one. A handler answers
// through the generated API, where no ResponseWriter reaches the code that
// picks the status, so the header is set here on the way out instead. wait is
// what the handler would have waited before refusing: the hashing limiter's
// queue drains within it, so the next request stands a fair chance after as
// long again. It is rounded to whole seconds and floored at [MinRetryAfter].
func WithRetryAfter(wait time.Duration) func(http.Handler) http.Handler {
	seconds := strconv.Itoa(int(max(wait.Round(time.Second), MinRetryAfter) / time.Second))
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(&retryAfterResponseWriter{ResponseWriter: w, seconds: seconds}, r)
		})
	}
}

type retryAfterResponseWriter struct {
	http.ResponseWriter
	seconds string
}

func (w *retryAfterResponseWriter) WriteHeader(code int) {
	if code == http.StatusTooManyRequests && w.Header().Get("Retry-After") == "" {
		w.Header().Set("Retry-After", w.seconds)
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
