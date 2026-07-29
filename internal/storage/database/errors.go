package database

import (
	"errors"

	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

var (
	// ErrNoChanges aliases the v2 sentinel so both pools share one identity.
	ErrNoChanges           = v2database.ErrNoChanges
	ErrInvalidChangeTarget = errors.New("change target must not be nil")
)

type MissingConditionError struct {
	col Column
}

func NewMissingConditionError(col Column) error {
	return &MissingConditionError{
		col: col,
	}
}

func (e *MissingConditionError) Error() string {
	var builder StatementBuilder
	builder.WriteString("missing condition for column")
	if e.col != nil {
		builder.WriteString(" on ")
		e.col.WriteQualified(&builder)
	}
	return builder.String()
}

func (e *MissingConditionError) Is(target error) bool {
	_, ok := target.(*MissingConditionError)
	return ok
}

// Integrity/query error types are owned by storage v2. v1 dialects keep these
// aliases so wrapError and remaining callers share one concrete type identity.

type NoRowFoundError = v2database.NoRowFoundError
type MultipleRowsFoundError = v2database.MultipleRowsFoundError
type IntegrityType = v2database.IntegrityType
type IntegrityViolationError = v2database.IntegrityViolationError
type CheckError = v2database.CheckError
type UniqueError = v2database.UniqueError
type ForeignKeyError = v2database.ForeignKeyError
type NotNullError = v2database.NotNullError
type ScanError = v2database.ScanError
type UnknownError = v2database.UnknownError
type UnimplementedError = v2database.UnimplementedError
type PermissionError = v2database.PermissionError

const (
	IntegrityTypeCheck   IntegrityType = v2database.IntegrityTypeCheck
	IntegrityTypeUnique  IntegrityType = v2database.IntegrityTypeUnique
	IntegrityTypeForeign IntegrityType = v2database.IntegrityTypeForeign
	IntegrityTypeNotNull IntegrityType = v2database.IntegrityTypeNotNull
)

func NewNoRowFoundError(original error) error {
	return v2database.NewNoRowFoundError(original)
}

func NewMultipleRowsFoundError(original error) error {
	return v2database.NewMultipleRowsFoundError(original)
}

func NewCheckError(table, constraint string, original error) error {
	return v2database.NewCheckError(table, constraint, original)
}

func NewUniqueError(table, constraint string, original error) error {
	return v2database.NewUniqueError(table, constraint, original)
}

func NewForeignKeyError(table, constraint string, original error) error {
	return v2database.NewForeignKeyError(table, constraint, original)
}

func NewNotNullError(table, constraint string, original error) error {
	return v2database.NewNotNullError(table, constraint, original)
}

func NewScanError(original error) error {
	return v2database.NewScanError(original)
}

func NewUnknownError(original error) error {
	return v2database.NewUnknownError(original)
}

func NewUnimplementedError(original error) error {
	return v2database.NewUnimplementedError(original)
}

func NewPermissionError(original error) error {
	return v2database.NewPermissionError(original)
}
