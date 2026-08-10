package api

import (
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/service"
)

// list-request translation shared by the query endpoints.

// sortingToService maps a request sorting object; F is the endpoint's sort-field enum.
func sortingToService[F ~string](field F, direction api.SortDirection) *service.Sorting {
	return &service.Sorting{Field: string(field), Direction: string(direction)}
}

// filterToService maps a request filter item; F is the endpoint's filter-field enum.
func filterToService[F ~string](field F, operation api.FilterOperation, value api.OptFilterValue) service.Filter {
	return service.Filter{Field: string(field), Operation: string(operation), Value: filterValue(value)}
}

// filterValue unwraps the filter-value union. An absent or null value stays
// nil; the service rejects whatever the filtered field cannot take.
func filterValue(value api.OptFilterValue) any {
	v, ok := value.Get()
	if !ok {
		return nil
	}
	switch v.Type {
	case api.StringFilterValue:
		return v.String
	case api.Float64FilterValue:
		return v.Float64
	case api.BoolFilterValue:
		return v.Bool
	default:
		return nil
	}
}