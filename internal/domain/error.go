package domain

import (
	"errors"
	"log/slog"

	"github.com/zitadel/nextgen/internal/errreport"
)

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
	Parent  error  `json:"-"`
	errreport.Origin
}

func (e Error) Error() string {
	return e.Message
}

func (e Error) Unwrap() error {
	return e.Parent
}

func (e Error) Is(target error) bool {
	var t Error
	if !errors.As(target, &t) {
		return false
	}
	if e.Code != t.Code {
		return false
	}
	if t.Parent != nil {
		return errors.Is(e.Parent, t.Parent)
	}
	return true
}

func (e Error) As(target any) bool {
	t, ok := target.(*Error)
	if !ok {
		return false
	}
	*t = e
	return true
}

// LogValue implements [slog.LogValuer]. Details are client-facing and omitted
// from logs by default (ADR 030).
func (e Error) LogValue() slog.Value {
	attrs := []slog.Attr{
		slog.String("code", e.Code),
		slog.String("message", e.Message),
	}
	if e.Parent != nil {
		attrs = append(attrs, slog.Any("parent", e.Parent))
	}
	if errreport.GCPReportingEnabled() {
		return slog.GroupValue(attrs...)
	}
	if loc := e.ReportLocation(); loc != nil {
		attrs = append(attrs, slog.Any("reportLocation", loc))
	}
	if trace, ok := e.StackTrace(); ok {
		attrs = append(attrs, slog.String("stackTrace", string(trace)))
	}
	return slog.GroupValue(attrs...)
}

// WithMessage returns a copy with the message overridden.
// Code is unchanged so errors.Is still matches the original sentinel.
func (e Error) WithMessage(msg string) Error {
	e.Message = msg
	return e
}

// WithDetails returns a copy with additional context attached.
// Code is unchanged so errors.Is still matches the original sentinel.
func (e Error) WithDetails(details any) Error {
	e.Details = details
	return e
}

// WithParent returns a copy wrapping a lower-level cause.
// Code is unchanged so errors.Is still matches the original sentinel.
func (e Error) WithParent(parent error) Error {
	e.Parent = parent
	e.Origin = errreport.Capture(parent, 1)
	return e
}

func newError(code string, message string, details any, parent error) Error {
	// Details is client-facing and only ever what a caller attaches explicitly;
	// Parent stays a log-only diagnostic and must not fall back into Details (ADR 030).
	if details == "" {
		details = nil
	}
	return Error{
		Code:    code,
		Message: message,
		Details: details,
		Parent:  parent,
		Origin:  errreport.Capture(parent, 2),
	}
}

func ErrNotImplemented() Error {
	return newError("not_implemented", "This feature is not implemented yet.", nil, nil)
}

// ErrInternal is the catch-all for unexpected errors that have no specific domain code.
func ErrInternal(err error) Error {
	return newError("internal", "An unexpected error occurred.", nil, err)
}

// ErrUnavailable is returned when a request failed for a transient reason and
// retrying it may succeed, typically a database transaction that exhausted its
// abort retries under contention. Separate from [ErrInternal] because the
// caller's correct response differs: retry, rather than report a bug.
func ErrUnavailable() Error {
	return newError("unavailable", "The service could not complete the request right now. Try again.", nil, nil)
}

// ErrRequestInvalid is returned when an incoming HTTP request fails structural
// validation (missing required fields, wrong types, failed regex, etc.)
// before it reaches domain logic.
func ErrRequestInvalid() Error {
	return newError("req.invalid", "The request is invalid and fails base validation (missing required fields, wrong types, failed regex, etc.). Check the details for more information.", nil, nil)
}

// RequestInvalidFieldDetails names a request field that failed validation.
// Producers must attach only the field path — never parser text or payload
// fragments (ADR 030 Decision 4 + 6).
type RequestInvalidFieldDetails struct {
	Field string `json:"field"`
}
