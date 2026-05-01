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
