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
	case errors.Is(err, ErrListFilterRequired):
		return domain.ErrInternal(err).WithMessage("authz list filter missing")
	default:
		return domain.ErrInternal(err).WithMessage(internalMsg)
	}
}

// parseSortDirection maps an API sort direction to a storage order direction.
func parseSortDirection(direction string) (database.OrderDirection, error) {
	switch direction {
	case sortAsc:
		return database.OrderAsc, nil
	case sortDesc:
		return database.OrderDesc, nil
	default:
		return database.OrderAsc, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown sort direction %q", direction))
	}
}

// listOrderBy builds the sort order from the request, using the given
// defaults when no sorting is requested, and appends idField as a tiebreaker:
// id is unique, so it gives the sort a total order. Without it, rows sharing
// a sort-key value (e.g. equal createdAt) have no stable order, and cursor
// pagination could skip or repeat them across pages.
func listOrderBy[F ~uint8](sorting *Sorting, defaultField F, defaultDirection database.OrderDirection, parseField func(string) (F, error), idField F) (database.OrderBy[F], error) {
	sortField := defaultField
	direction := defaultDirection

	if sorting != nil {
		f, err := parseField(sorting.Field)
		if err != nil {
			return database.OrderBy[F]{}, err
		}
		sortField = f
		dir, err := parseSortDirection(sorting.Direction)
		if err != nil {
			return database.OrderBy[F]{}, err
		}
		direction = dir
	}

	columns := []database.Column[F]{database.Col(sortField)}
	if sortField != idField {
		columns = append(columns, database.Col(idField))
	}
	return database.OrderBy[F]{Columns: columns, Direction: direction}, nil
}

// createdAtFilter maps an operation to a comparison filter on a timestamp
// column. The value arrives as an untyped string (the filter-value union in
// the openapi contract does not specify a format for a timestamp); parse it
// into the time.Time needed for the comparison.
func createdAtFilter[F ~uint8](op string, col database.Column[F], value any) (database.Filter[F], error) {
	raw, ok := value.(string)
	if !ok {
		return nil, domain.ErrRequestInvalid().WithDetails("created_at filter value must be an RFC3339 string")
	}
	t, err := database.CoerceTimeValue(raw)
	if err != nil {
		return nil, domain.ErrRequestInvalid().WithDetails(
			fmt.Sprintf("created_at filter value %q is not a valid RFC3339 timestamp", raw))
	}
	return compareFilter(op, col, t)
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
	case filterOpGreaterThanOrEqual:
		return database.GreaterThanOrEqual(col, value), nil
	case filterOpNotEquals, filterOpLessThanOrEqual:
		// todo (grvijayan): update when these operations are supported
		return nil, domain.ErrNotImplemented().WithDetails(fmt.Sprintf("operation %q is not supported", op))
	case filterOpContains, filterOpNotContains:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("operation %q is not valid for this field", op))
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown operation %q", op))
	}
}

// stringFilterValue asserts the filter's value is a string, naming the field
// in the error detail.
func stringFilterValue(f Filter) (string, error) {
	value, ok := f.Value.(string)
	if !ok {
		return "", domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("%s filter value must be a string", f.Field))
	}
	return value, nil
}

// stringFilter maps an operation to a text filter.
func stringFilter[F ~uint8](op string, col database.Column[F], value string) (database.Filter[F], error) {
	switch op {
	case filterOpEquals:
		return database.StringEqual(col, value), nil
	case filterOpContains:
		return database.StringContainsFold(col, value), nil
	case filterOpNotEquals, filterOpNotContains:
		// todo (grvijayan): update when these operations are supported
		return nil, domain.ErrNotImplemented().WithDetails(fmt.Sprintf("operation %q is not supported", op))
	case filterOpLessThan, filterOpGreaterThan, filterOpLessThanOrEqual, filterOpGreaterThanOrEqual:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("operation %q is not valid for this field", op))
	default:
		return nil, domain.ErrRequestInvalid().WithDetails(fmt.Sprintf("unknown operation %q", op))
	}
}
