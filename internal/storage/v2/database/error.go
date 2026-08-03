package database

import (
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/errreport"
)

// ErrNoChanges is returned when an Update is called with no updates.
var ErrNoChanges = errors.New("update must contain a change")

// Error is a coded storage error. Services map it to domain.Error at the boundary.
type Error struct {
	Code    string
	Message string
	Details any
	Parent  error
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

// WithParent returns a copy wrapping a lower-level cause.
// Code is unchanged so errors.Is still matches the original sentinel.
func (e Error) WithParent(parent error) Error {
	e.Parent = parent
	e.Origin = errreport.Capture(parent, 1)
	return e
}

// NewError constructs a storage v2 database error.
func NewError(code string, message string, details any, parent error) Error {
	if details == "" {
		details = nil
	}
	return Error{
		Code:    code,
		Message: message,
		Details: details,
		Parent:  parent,
		Origin:  errreport.Capture(parent, 1),
	}
}

func ErrInvalidCursor() Error {
	return NewError("db.invalid_cursor", "The provided cursor is invalid.", nil, nil)
}

func ErrCursorOrderMismatch() Error {
	return NewError("db.cursor_order_mismatch", "The provided cursor does not match the order by clause.", nil, nil)
}

func ErrCursorLengthMismatch() Error {
	return NewError("db.cursor_length_mismatch", "Cursor columns and values length mismatch.", nil, nil)
}

func ErrMissingFieldCoerce(field any) Error {
	return NewError("db.missing_field_coerce", "The schema is missing a coerce function for a field.", field, nil)
}

func ErrCoerceExpectedType(want string, got any) Error {
	return NewError(
		"db.coerce_type",
		"The cursor value has an unexpected type.",
		map[string]any{"want": want, "got": fmt.Sprintf("%T", got)},
		nil,
	)
}

func ErrCoerceParse(message string, parent error) Error {
	return NewError("db.coerce_parse", message, nil, parent)
}

func ErrCoerceExpectedSlice(got any) Error {
	return NewError("db.coerce_type", "The cursor value is not a slice.", got, nil)
}

func ErrCoerceSliceElement(index int, parent error) Error {
	return NewError("db.coerce_slice_element", "A cursor slice element could not be coerced.", index, parent)
}

func ErrCoerceEnumMapKey(key string, parent error) Error {
	return NewError("db.coerce_enum_map_key", "A cursor map key could not be coerced.", key, parent)
}

func ErrDialectAlreadyRegistered(name string) Error {
	return NewError("db.dialect_already_registered", "The database dialect is already registered.", name, nil)
}

func ErrNoDialectConfigured() Error {
	return NewError("db.no_dialect_configured", "No database dialect is configured.", nil, nil)
}

func ErrMultipleDialectsConfigured(count int, keys []string) Error {
	return NewError(
		"db.multiple_dialects_configured",
		"Exactly one database dialect must be configured.",
		map[string]any{"count": count, "keys": keys},
		nil,
	)
}

func ErrUnsupportedDialect(name string) Error {
	return NewError("db.unsupported_dialect", "The database dialect is not supported.", name, nil)
}

func ErrDecodeDialect(name string, parent error) Error {
	return NewError("db.decode_dialect", "The database dialect configuration could not be decoded.", name, parent)
}

func ErrInvalidDialectConfig(details any) Error {
	return NewError("db.invalid_dialect_config", "The database dialect configuration is invalid.", details, nil)
}

func ErrInvalidEnumKey(key string) Error {
	return NewError("db.invalid_enum_key", "The enum key could not be parsed.", key, nil)
}
