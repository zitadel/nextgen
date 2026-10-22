package api

import (
	"fmt"
	"net/http"
	"runtime/debug"

	"github.com/zitadel/nextgen/internal/domain"
)

// WithRecover turns a handler panic into the standard internal error
// response and one API error line with the panic's stack. A panic after the
// response started aborts the connection instead, so the client does not
// take a truncated response for a success. http.ErrAbortHandler is
// re-panicked, as net/http expects.
func WithRecover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tw := &headerTrackingWriter{ResponseWriter: w}
		defer func() {
			p := recover()
			if p == nil {
				return
			}
			if p == http.ErrAbortHandler {
				panic(p)
			}
			// The domain error takes the panic's stack from its parent,
			// whatever the stack trace setting says: a panic is a bug.
			logAPIError(r.Context(), http.StatusInternalServerError,
				domain.ErrInternal(panicError{value: p, stack: debug.Stack()}))
			if tw.wroteHeader {
				panic(http.ErrAbortHandler)
			}
			writeErrorDetails(w, http.StatusInternalServerError, domainErrorDetails(domain.ErrInternal(nil)))
		}()
		next.ServeHTTP(tw, r)
	})
}

// panicError carries a recovered panic and the stack where it happened.
type panicError struct {
	value any
	stack []byte
}

func (e panicError) Error() string { return fmt.Sprintf("panic: %v", e.value) }

func (e panicError) StackTrace() ([]byte, bool) { return e.stack, true }

// headerTrackingWriter records whether the response has started, after which
// a panic can no longer be answered with an error body.
type headerTrackingWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *headerTrackingWriter) WriteHeader(code int) {
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(code)
}

func (w *headerTrackingWriter) Write(b []byte) (int, error) {
	w.wroteHeader = true
	return w.ResponseWriter.Write(b)
}

// Flush keeps streaming working through the wrapper; flushing sends the
// headers.
func (w *headerTrackingWriter) Flush() {
	w.wroteHeader = true
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}

// Unwrap lets http.NewResponseController reach the writer underneath.
func (w *headerTrackingWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
