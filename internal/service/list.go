package service

import (
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
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
	case errors.Is(err, v2database.ErrInvalidCursor()):
		return domain.ErrRequestInvalid().WithDetails("invalid page token")
	case errors.Is(err, v2database.ErrCursorOrderMismatch()):
		return domain.ErrRequestInvalid().WithDetails("page token does not match the requested sorting")
	default:
		return domain.ErrInternal(err).WithMessage(internalMsg)
	}
}

// parseSortDirection maps an API sort direction to a storage order direction.
// An empty direction defaults to ascending.
func parseSortDirection(direction string) (v2database.OrderDirection, error) {
	switch direction {
	case "", sortAsc:
		return v2database.OrderAsc, nil
	case sortDesc:
		return v2database.OrderDesc, nil
	default:
		return v2database.OrderAsc, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown sort direction %q", direction))
	}
}

// compareFilter maps an operation to a comparison filter for an ordered column (e.g. a timestamp or number).
func compareFilter[F ~uint8](op string, col v2database.Column[F], value any) (v2database.Filter[F], error) {
	switch op {
	case filterOpEquals:
		return v2database.Equal(col, value), nil
	case filterOpLessThan:
		return v2database.LessThan(col, value), nil
	case filterOpGreaterThan:
		return v2database.GreaterThan(col, value), nil
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
func stringFilter[F ~uint8](op string, col v2database.Column[F], value string) (v2database.Filter[F], error) {
	switch op {
	case filterOpEquals:
		return v2database.StringEqual(col, value), nil
	case filterOpContains:
		return v2database.StringContains(col, value), nil
	case filterOpNotEquals, filterOpNotContains:
		// todo (grvijayan): update when these operations are supported
		return nil, domain.ErrNotImplemented().WithDetails(fmt.Sprintf("operation %q is not supported", op))
	case filterOpLessThan, filterOpGreaterThan, filterOpLessThanOrEqual, filterOpGreaterThanOrEqual:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("operation %q is not valid for this field", op))
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown operation %q", op))
	}
}
