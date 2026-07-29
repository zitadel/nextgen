package database

import (
	v2errors "github.com/zitadel/nextgen/internal/storage/v2/database/errors"
)

// Keep the legacy `internal/storage/v2/database` import path working by
// aliasing the integrity/query errors into this package.
//
// These types live in `internal/storage/v2/database/errors` to avoid an import
// cycle with `internal/domain` (domain needs `NoRowFoundError`, while v2/database
// also imports domain for cursor/domain.Error types).

type NoRowFoundError = v2errors.NoRowFoundError
type MultipleRowsFoundError = v2errors.MultipleRowsFoundError

type IntegrityType = v2errors.IntegrityType

const (
	IntegrityTypeCheck   IntegrityType = v2errors.IntegrityTypeCheck
	IntegrityTypeUnique  IntegrityType = v2errors.IntegrityTypeUnique
	IntegrityTypeForeign IntegrityType = v2errors.IntegrityTypeForeign
	IntegrityTypeNotNull IntegrityType = v2errors.IntegrityTypeNotNull
)

type IntegrityViolationError = v2errors.IntegrityViolationError
type CheckError = v2errors.CheckError
type UniqueError = v2errors.UniqueError
type ForeignKeyError = v2errors.ForeignKeyError
type NotNullError = v2errors.NotNullError

type ScanError = v2errors.ScanError
type UnknownError = v2errors.UnknownError
type UnimplementedError = v2errors.UnimplementedError
type PermissionError = v2errors.PermissionError

func NewNoRowFoundError(original error) error {
	return v2errors.NewNoRowFoundError(original)
}

func NewMultipleRowsFoundError(original error) error {
	return v2errors.NewMultipleRowsFoundError(original)
}

func NewCheckError(table, constraint string, original error) error {
	return v2errors.NewCheckError(table, constraint, original)
}

func NewUniqueError(table, constraint string, original error) error {
	return v2errors.NewUniqueError(table, constraint, original)
}

func NewForeignKeyError(table, constraint string, original error) error {
	return v2errors.NewForeignKeyError(table, constraint, original)
}

func NewNotNullError(table, constraint string, original error) error {
	return v2errors.NewNotNullError(table, constraint, original)
}

func NewScanError(original error) error {
	return v2errors.NewScanError(original)
}

func NewUnknownError(original error) error {
	return v2errors.NewUnknownError(original)
}

func NewUnimplementedError(original error) error {
	return v2errors.NewUnimplementedError(original)
}

func NewPermissionError(original error) error {
	return v2errors.NewPermissionError(original)
}
