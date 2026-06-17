package query

import "github.com/zitadel/nextgen/internal/storage/v2/query/flowdefinition"

// FlowDefinitionPurposeContains matches rows whose purposes array contains the purpose.
// SQL shape is dialect-specific (= ANY vs IN UNNEST).
type FlowDefinitionPurposeContains struct {
	Purpose string
}

func (FlowDefinitionPurposeContains) isFilter() {}

func (FlowDefinitionPurposeContains) Restricts(column any) bool {
	_ = column.(flowdefinition.Column)
	return false
}
