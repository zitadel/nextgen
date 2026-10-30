package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// UnrecordedErrorMessage is the message of the line a 4xx or 5xx answer gets
// when nothing recorded the error behind it. Every such answer should come
// with a [RecordError]; the integration harness fails a run that logs this.
const UnrecordedErrorMessage = "api error without a recorded cause"

type errorHolderKey struct{}

// errorHolder is the request's recorded error. [WithLogging] puts one on the
// context and writes its line when the response is served.
type errorHolder struct {
	err   error
	attrs []slog.Attr
	// clientGone is whether the request context was done when the error was
	// recorded: the client left, or net/http ended the request.
	clientGone bool
	recorded   bool
}

func withErrorHolder(ctx context.Context) (context.Context, *errorHolder) {
	holder := new(errorHolder)
	return context.WithValue(ctx, errorHolderKey{}, holder), holder
}

// RecordError records err as the cause of the request's error answer, with
// attrs for its line. [WithLogging] writes the one `api error` line a
// request gets just before its request line, from the last error recorded
// and the status the response carried (ADR 030). Whether the client is still
// there is read now, as the request context may be done by then; record
// with [context.WithoutCancel] to say it does not matter. On a route without
// WithLogging nothing is recorded.
func RecordError(ctx context.Context, err error, attrs ...slog.Attr) {
	holder, ok := ctx.Value(errorHolderKey{}).(*errorHolder)
	if !ok {
		return
	}
	holder.err = err
	holder.attrs = attrs
	holder.clientGone = ctx.Err() != nil
	holder.recorded = true
}

// RecordedError returns the error recorded on ctx so far, for tests of the
// code that records it.
func RecordedError(ctx context.Context) (error, bool) {
	holder, ok := ctx.Value(errorHolderKey{}).(*errorHolder)
	if !ok || !holder.recorded {
		return nil, false
	}
	return holder.err, true
}

// log writes the request's error line, if it has one: an error was recorded,
// or the status says something went wrong and nothing recorded what.
func (h *errorHolder) log(ctx context.Context, logger *slog.Logger, status int, operationID string) {
	if !h.recorded {
		if status >= http.StatusBadRequest {
			logger.LogAttrs(ctx, slog.LevelWarn, UnrecordedErrorMessage,
				slog.Int("status", status),
				slog.String("operation_id", operationID),
			)
		}
		return
	}
	err, ok := errors.AsType[domain.Error](h.err)
	if !ok {
		err = domain.ErrInternal(h.err)
	}
	// A server fault answered below 500 is a panic after the response
	// started: the connection was aborted, and the line still says Error.
	fault := status >= http.StatusInternalServerError || domain.IsServerFault(err)
	level := slog.LevelInfo
	switch {
	// The request context is done when the client left, or when net/http hit
	// the server's write deadline, which the deadline error tells apart.
	case fault && h.clientGone && !errors.Is(err, os.ErrDeadlineExceeded):
		level = slog.LevelWarn
	case fault:
		level = slog.LevelError
	// A dependency that did not answer, behind an answer the client can act
	// on (a step shown again with the provider unavailable), is still the
	// operator's to look at.
	case domain.IsDependencyFault(err):
		level = slog.LevelWarn
	}
	var logged error = err
	if level < slog.LevelError {
		logged = err.Brief()
	}
	attrs := append([]slog.Attr{
		slog.Int("status", status),
		slog.String("operation_id", operationID),
		slog.Any(zlog.ErrorAttributeKey, logged),
	}, h.attrs...)
	logger.LogAttrs(ctx, level, "api error", attrs...)
}
