package flowdefinition

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// ExtractPurposeContains pulls an OpEqual filter on Purposes out of the tree so
// dialects can emit array-contains SQL instead of a plain column compare.
func ExtractPurposeContains(filter database.Filter[domain.FlowDefinitionField]) (purpose string, remaining database.Filter[domain.FlowDefinitionField]) {
	return extractEqual(filter, domain.FlowDefinitionFieldPurposes, stringFilterValue)
}

// ExtractStatusEqual pulls an OpEqual filter on Status so Postgres can bind the
// enum cast that plain compare compilation does not apply.
func ExtractStatusEqual(filter database.Filter[domain.FlowDefinitionField]) (status string, remaining database.Filter[domain.FlowDefinitionField]) {
	return extractEqual(filter, domain.FlowDefinitionFieldStatus, stringFilterValue)
}

func extractEqual(
	filter database.Filter[domain.FlowDefinitionField],
	field domain.FlowDefinitionField,
	stringify func(any) string,
) (value string, remaining database.Filter[domain.FlowDefinitionField]) {
	if filter == nil {
		return "", nil
	}
	switch f := filter.(type) {
	case database.AndFilter[domain.FlowDefinitionField]:
		kept := make([]database.Filter[domain.FlowDefinitionField], 0, len(f.Filters))
		for _, child := range f.Filters {
			v, rest := extractEqual(child, field, stringify)
			if v != "" {
				value = v
			}
			if rest != nil {
				kept = append(kept, rest)
			}
		}
		switch len(kept) {
		case 0:
			return value, nil
		case 1:
			return value, kept[0]
		default:
			return value, database.And(kept...)
		}
	case *database.CompareFilter[domain.FlowDefinitionField]:
		if f.Op == database.OpEqual && len(f.Terms) == 1 && f.Terms[0].Column.Field() == field {
			return stringify(f.Terms[0].Value), nil
		}
		return "", f
	default:
		return "", filter
	}
}

// Call sites pass .String() for purpose/status equals filters.
func stringFilterValue(v any) string {
	s, _ := v.(string)
	return s
}
