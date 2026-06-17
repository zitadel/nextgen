package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/query"
	flowdefquery "github.com/zitadel/nextgen/internal/storage/v2/query/flowdefinition"
)

// ListActiveLoginFlows demonstrates v2 list options with project scope and filters.
func ListActiveLoginFlows(ctx context.Context, pool database.Pool, projectID string) ([]*domain.FlowDefinition, error) {
	opts := query.ListOptions[flowdefquery.Column]{
		Filter: query.And(
			query.TextEquals(flowdefquery.ColProjectID, projectID),
			query.EnumEquals(flowdefquery.ColStatus, domain.FlowDefinitionStatusActive.String()),
			query.FlowDefinitionPurposeContains{Purpose: domain.FlowDefinitionPurposeLogin.String()},
		),
		OrderBy: []query.OrderBy[flowdefquery.Column]{
			{Column: flowdefquery.ColCreatedAt, Direction: query.OrderDesc},
			{Column: flowdefquery.ColID, Direction: query.OrderDesc},
		},
		Page: query.PageLimit{Limit: 50},
	}
	result, err := pool.FlowDefinition().List(opts).Execute(ctx)
	if err != nil {
		return nil, err
	}
	return result.Items, nil
}
