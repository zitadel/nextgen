package domain

import (
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
)

type Error struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Details  any    `json:"details,omitempty"`
	Parent   error
	Location string
}

func (e Error) Error() string {
	if e.Parent != nil {
		return e.Message + ": " + e.Parent.Error()
	}
	return e.Message
}

func (e Error) Is(target error) bool {
	var t Error
	if !errors.As(target, &t) {
		return false
	}
	return e.Code == t.Code
}

func (e Error) As(target any) bool {
	t, ok := target.(*Error)
	if !ok {
		return false
	}
	*t = e
	return true
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
	return e
}

func newError(code string, message string, details any, parent error) Error {
	_, file, line, _ := runtime.Caller(2) // Skip 2: newErr + the Wrapper function
	return Error{
		Code:     code,
		Message:  message,
		Details:  details,
		Parent:   parent,
		Location: fmt.Sprintf("%s:%d", filepath.Base(file), line),
	}
}

// ErrInternal is the catch-all for unexpected errors that have no specific domain code.
func ErrInternal(err error) Error {
	return newError("internal", "an unexpected error occurred", nil, err)
}
