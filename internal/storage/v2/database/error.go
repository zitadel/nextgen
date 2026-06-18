package database

import (
	"fmt"
	"path/filepath"
	"runtime"

	"github.com/zitadel/nextgen/internal/domain"
)

func newError(code string, message string, details any, parent error) domain.Error {
	_, file, line, _ := runtime.Caller(2) // Skip 2: newErr + the Wrapper function
	return domain.Error{
		Code:     code,
		Message:  message,
		Details:  details,
		Parent:   parent,
		Location: fmt.Sprintf("%s:%d", filepath.Base(file), line),
	}
}

func ErrInvalidCursor() domain.Error {
	return newError("db.invalid_cursor", "The provided cursor is invalid.", nil, nil)
}
