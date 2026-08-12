package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/flowdefinition"
)

const (
	statusCast     = "::zitadel_nextgen.flow_definition_states"
	purposeArrCast = "::zitadel_nextgen.flow_definition_purposes[]"

	createFlowDefinitionStmt = `INSERT INTO zitadel_nextgen.flow_definitions ` +
		`(project_id, id, name, schema_version, status, purposes, definition, created_at, updated_at) ` +
		`VALUES ($1, $2, $3, $4, $5` + statusCast + `, $6` + purposeArrCast + `, $7, NOW(), NOW())`

	deleteFlowDefinitionStmt = `DELETE FROM zitadel_nextgen.flow_definitions WHERE project_id = $1 AND id = $2`

	updateFlowDefinitionStmt = `UPDATE zitadel_nextgen.flow_definitions SET ` +
		`name = $1, schema_version = $2, status = $3` + statusCast + `, purposes = $4` + purposeArrCast + `, ` +
		`definition = $5, updated_at = NOW() WHERE project_id = $6 AND id = $7`

	flowDefinitionQuery = `SELECT project_id, id, name, schema_version, status, definition, created_at, updated_at ` +
		`FROM zitadel_nextgen.flow_definitions`
)

type flowDefinitionStatements struct{ statement }

func newFlowDefinitionStatements(client queryExecutor) flowDefinitionStatements {
	return flowDefinitionStatements{
		statement: statement{
			client: client,
		},
	}
}

// CreateFlowDefinition implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) CreateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error {
	if err := ensureManagedID(&entity.ID, domain.FlowDefinitionPrefix); err != nil {
		return err
	}
	content, err := flowdefinition.Marshal(entity)
	if err != nil {
		return err
	}
	purposes := flowdefinition.PurposeStrings(entity)
	return withTransaction(ctx, f.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, createFlowDefinitionStmt,
			entity.ProjectID,
			entity.ID,
			entity.Name,
			entity.SchemaVersion,
			entity.Status.String(),
			purposes,
			content,
		); err != nil {
			return wrapError(err)
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindFlowDefinition, entity.ProjectID, entity.ID))
	})
}

// GetFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) GetFlowDefinitionByID(ctx context.Context, projectID, id string) (*domain.FlowDefinition, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, flowDefinitionQuery, &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
			database.Equal(database.Col(domain.FlowDefinitionFieldID), id),
		),
	}, flowdefinition.Schema); err != nil {
		return nil, err
	}

	rows, err := f.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	def, err := pgx.CollectExactlyOneRow(rows, f.scanFlowDefinition)
	if err != nil {
		return nil, wrapError(err)
	}
	return def, nil
}

// UpdateFlowDefinition implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) UpdateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error {
	content, err := flowdefinition.Marshal(entity)
	if err != nil {
		return err
	}
	purposes := flowdefinition.PurposeStrings(entity)
	_, err = f.client.Exec(ctx, updateFlowDefinitionStmt,
		entity.Name,
		entity.SchemaVersion,
		entity.Status.String(),
		purposes,
		content,
		entity.ProjectID,
		entity.ID,
	)
	return wrapError(err)
}

// ListFlowDefinitions implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) ListFlowDefinitions(ctx context.Context, filter *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
	opts := flowdefinition.EnsureListOptions(filter)

	var compiler statementCompiler
	err := compileRead(&compiler, flowDefinitionQuery, opts, flowdefinition.Schema)
	if err != nil {
		return nil, err
	}

	rows, err := f.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defs, err := pgx.CollectRows(rows, f.scanFlowDefinition)
	if err != nil {
		return nil, wrapError(err)
	}

	nextCursor := pagination.MarshalNext(
		opts.Pagination.OrderBy,
		defs,
		flowdefinition.Schema,
		opts.Pagination.Limit,
	)

	return &database.ListResult[*domain.FlowDefinition]{
		Items:      defs,
		NextCursor: nextCursor,
	}, nil
}

// DeleteFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) DeleteFlowDefinitionByID(ctx context.Context, projectID, id string) error {
	return withTransaction(ctx, f.client, func(ctx context.Context, tx queryExecutor) error {
		tag, err := tx.Exec(ctx, deleteFlowDefinitionStmt, projectID, id)
		if err != nil {
			return wrapError(err)
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.DeleteResourceScope(ctx, domain.ResourceKindFlowDefinition, projectID, id)
	})
}

func (f flowDefinitionStatements) scanFlowDefinition(row pgx.CollectableRow) (*domain.FlowDefinition, error) {
	var (
		projectID, id, name, schemaVersion string
		status                             domain.FlowDefinitionStatus
		definition                         []byte
		createdAt, updatedAt               time.Time
	)
	if err := row.Scan(&projectID, &id, &name, &schemaVersion, &status, &definition, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return flowdefinition.ToDomain(projectID, id, name, schemaVersion, status, createdAt, updatedAt, definition)
}

var _ service.FlowDefinitionStatements = (*flowDefinitionStatements)(nil)
