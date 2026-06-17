package repository

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	v2postgres "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"
	v2spanner "github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner"
	"github.com/zitadel/nextgen/internal/storage/v2/query"
	flowdefquery "github.com/zitadel/nextgen/internal/storage/v2/query/flowdefinition"
)

// FlowDefinitionRepository implements [domain.FlowDefinitionRepository] via storage v2.
type FlowDefinitionRepository struct{}

// NewFlowDefinitionRepository returns a v2-backed flow definition repository.
func NewFlowDefinitionRepository(client storagedb.QueryExecutor) *FlowDefinitionRepository {
	if _, err := statementerFrom(client); err != nil {
		panic(fmt.Sprintf("NewFlowDefinitionRepository: %v", err))
	}
	return &FlowDefinitionRepository{}
}

var _ domain.FlowDefinitionRepository = (*FlowDefinitionRepository)(nil)

func statementerFrom(client storagedb.QueryExecutor) (v2database.Statementer, error) {
	if st, ok := v2postgres.StatementerFromClient(client); ok {
		return st, nil
	}
	if st, ok := v2spanner.StatementerFromClient(client); ok {
		return st, nil
	}
	return nil, fmt.Errorf("unsupported client type %T", client)
}

func (r *FlowDefinitionRepository) CreateFlowDefinition(ctx context.Context, client storagedb.QueryExecutor, def *domain.FlowDefinition) error {
	st, err := statementerFrom(client)
	if err != nil {
		return err
	}
	return st.FlowDefinition().Create(def).Execute(ctx)
}

func (r *FlowDefinitionRepository) GetFlowDefinition(ctx context.Context, client storagedb.QueryExecutor, projectID, id string) (*domain.FlowDefinition, error) {
	st, err := statementerFrom(client)
	if err != nil {
		return nil, err
	}
	return st.FlowDefinition().GetByID(projectID, id).Execute(ctx)
}

func (r *FlowDefinitionRepository) ListFlowDefinitions(ctx context.Context, client storagedb.QueryExecutor, projectID string, opts ...domain.FlowDefinitionListOption) ([]*domain.FlowDefinition, error) {
	result, err := r.ListFlowDefinitionsPage(ctx, client, projectID, opts...)
	if err != nil {
		return nil, err
	}
	return result.Items, nil
}

func (r *FlowDefinitionRepository) ListFlowDefinitionsPage(ctx context.Context, client storagedb.QueryExecutor, projectID string, opts ...domain.FlowDefinitionListOption) (*domain.FlowDefinitionListResult, error) {
	st, err := statementerFrom(client)
	if err != nil {
		return nil, err
	}
	listOpts := listOptionsFromDomain(projectID, domain.ApplyFlowDefinitionListOptions(opts))
	result, err := st.FlowDefinition().List(listOpts).Execute(ctx)
	if err != nil {
		return nil, err
	}
	return &domain.FlowDefinitionListResult{
		Items:      result.Items,
		NextCursor: cursorToDomain(result.NextCursor),
	}, nil
}

func (r *FlowDefinitionRepository) UpdateFlowDefinitionStatus(ctx context.Context, client storagedb.QueryExecutor, projectID, id string, status domain.FlowDefinitionStatus) error {
	st, err := statementerFrom(client)
	if err != nil {
		return err
	}
	return st.FlowDefinition().UpdateStatus(projectID, id, status).Execute(ctx)
}

func (r *FlowDefinitionRepository) DeleteFlowDefinition(ctx context.Context, client storagedb.QueryExecutor, projectID, id string) error {
	st, err := statementerFrom(client)
	if err != nil {
		return err
	}
	return st.FlowDefinition().Delete(projectID, id).Execute(ctx)
}

func listOptionsFromDomain(projectID string, o *domain.FlowDefinitionListOpts) query.ListOptions[flowdefquery.Column] {
	filters := []query.Filter{
		query.TextEquals(flowdefquery.ColProjectID, projectID),
	}
	if o.Name != nil {
		filters = append(filters, query.TextEquals(flowdefquery.ColName, *o.Name))
	}
	if o.Status != nil {
		filters = append(filters, query.EnumEquals(flowdefquery.ColStatus, o.Status.String()))
	}
	if o.Purpose != nil {
		filters = append(filters, query.FlowDefinitionPurposeContains{Purpose: o.Purpose.String()})
	}
	if o.SchemaVersion != nil {
		filters = append(filters, query.TextEquals(flowdefquery.ColSchemaVersion, *o.SchemaVersion))
	}

	orderBy := []query.OrderBy[flowdefquery.Column]{
		{Column: flowdefquery.ColCreatedAt, Direction: query.OrderDesc},
		{Column: flowdefquery.ColID, Direction: query.OrderDesc},
	}

	opts := query.ListOptions[flowdefquery.Column]{
		Filter:  query.And(filters...),
		OrderBy: orderBy,
	}

	if o.Cursor != nil {
		opts.Page = query.PageCursor[flowdefquery.Column]{
			After:      query.NewFlowDefinitionCursor(o.Cursor.CreatedAt, o.Cursor.ID),
			Limit:      o.Limit,
			KeyColumns: orderBy,
		}
	} else if o.Limit > 0 || o.Offset > 0 {
		opts.Page = query.PageLimit{Limit: o.Limit, Offset: o.Offset}
	}
	return opts
}

func cursorToDomain(token *query.CursorToken) *domain.FlowDefinitionListCursor {
	if token == nil {
		return nil
	}
	cursor, err := query.ParseFlowDefinitionCursor(token)
	if err != nil {
		return nil
	}
	return &domain.FlowDefinitionListCursor{
		CreatedAt: cursor.CreatedAt,
		ID:        cursor.ID,
	}
}
