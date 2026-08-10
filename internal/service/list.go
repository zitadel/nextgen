package service

import (
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// list-query translation for resource List endpoints.

const (
	// filter operations
	filterOpEquals             = "equals"
	filterOpNotEquals          = "not_equals"
	filterOpContains           = "contains"
	filterOpNotContains        = "not_contains"
	filterOpLessThan           = "less_than"
	filterOpLessThanOrEqual    = "less_than_or_equal"
	filterOpGreaterThan        = "greater_than"
	filterOpGreaterThanOrEqual = "greater_than_or_equal"

	// sort directions
	sortAsc  = "asc"
	sortDesc = "desc"

	// list limits
	defaultListLimit = 20
	maxListLimit     = 100
)

// Sorting selects the field and direction a list is ordered by.
type Sorting struct {
	Field     string
	Direction string
}

// Filter is a single field/operation/value predicate from a list request.
type Filter struct {
	Field     string
	Operation string
	Value     any
}

// normalizeLimit applies defaultListLimit for non-positive limits and caps oversized ones at maxListLimit.
func normalizeLimit(limit int) int {
	if limit <= 0 {
		return defaultListLimit
	}
	if limit > maxListLimit {
		return maxListLimit
	}
	return limit
}

// mapListError translates storage-layer list errors into domain errors.
func mapListError(err error, internalMsg string) error {
	switch {
	case errors.Is(err, database.ErrInvalidCursor()):
		return domain.ErrRequestInvalid().WithDetails("invalid page token")
	case errors.Is(err, database.ErrCursorOrderMismatch()):
		return domain.ErrRequestInvalid().WithDetails("page token does not match the requested sorting")
	default:
		return domain.ErrInternal(err).WithMessage(internalMsg)
	}
}

// parseSortDirection maps an API sort direction to a storage order direction.
// An empty direction defaults to ascending.
func parseSortDirection(direction string) (database.OrderDirection, error) {
	switch direction {
	case "", sortAsc:
		return database.OrderAsc, nil
	case sortDesc:
		return database.OrderDesc, nil
	default:
		return database.OrderAsc, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown sort direction %q", direction))
	}
}

// compareFilter maps an operation to a comparison filter for an ordered column (e.g. a timestamp or number).
func compareFilter[F ~uint8](op string, col database.Column[F], value any) (database.Filter[F], error) {
	switch op {
	case filterOpEquals:
		return database.Equal(col, value), nil
	case filterOpLessThan:
		return database.LessThan(col, value), nil
	case filterOpGreaterThan:
		return database.GreaterThan(col, value), nil
	case filterOpNotEquals, filterOpLessThanOrEqual, filterOpGreaterThanOrEqual:
		// todo (grvijayan): update when these operations are supported
		return nil, domain.ErrNotImplemented().WithDetails(fmt.Sprintf("operation %q is not supported", op))
	case filterOpContains, filterOpNotContains:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("operation %q is not valid for this field", op))
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown operation %q", op))
	}
}

// stringFilter maps an operation to a text filter.
func stringFilter[F ~uint8](op string, col database.Column[F], value string) (database.Filter[F], error) {
	switch op {
	case filterOpEquals:
		return database.StringEqual(col, value), nil
	case filterOpContains:
		return database.StringContains(col, value), nil
	case filterOpNotEquals, filterOpNotContains:
		// todo (grvijayan): update when these operations are supported
		return nil, domain.ErrNotImplemented().WithDetails(fmt.Sprintf("operation %q is not supported", op))
	case filterOpLessThan, filterOpGreaterThan, filterOpLessThanOrEqual, filterOpGreaterThanOrEqual:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("operation %q is not valid for this field", op))
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown operation %q", op))
	}
}
