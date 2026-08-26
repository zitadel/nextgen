package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/flowdefinition"
)

const (
	flowDefinitionsTable = "flow_definitions"

	createFlowDefinitionStmt = `INSERT INTO flow_definitions ` +
		`(project_id, id, name, schema_version, status, purposes, definition, created_at, updated_at) ` +
		`VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()) THEN RETURN created_at, updated_at`

	deleteFlowDefinitionStmt = `DELETE FROM flow_definitions WHERE project_id = @p1 AND id = @p2`

	updateFlowDefinitionStmt = `UPDATE flow_definitions SET ` +
		`name = @p1, schema_version = @p2, status = @p3, purposes = @p4, ` +
		`definition = @p5, updated_at = CURRENT_TIMESTAMP() WHERE project_id = @p6 AND id = @p7 THEN RETURN created_at, updated_at`

	flowDefinitionQuery = `SELECT project_id, id, name, schema_version, status, definition, created_at, updated_at ` +
		`FROM flow_definitions`
)

var flowDefinitionColumns = []string{
	"project_id", "id", "name", "schema_version", "status", "definition", "created_at", "updated_at",
}

type flowDefinitionStatements struct{ statement }

func newFlowDefinitionStatements(db queryExecutor) flowDefinitionStatements {
	return flowDefinitionStatements{
		statement: statement{
			db: db,
		},
	}
}

func (f flowDefinitionStatements) CreateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error {
	if err := ensureManagedID(&entity.ID, domain.FlowDefinitionPrefix); err != nil {
		return err
	}
	content, err := flowdefinition.Marshal(entity)
	if err != nil {
		return err
	}
	definition, err := encodeNullJSON(content)
	if err != nil {
		return wrapError(err)
	}
	purposes := flowdefinition.PurposeStrings(entity)
	return withTransaction(ctx, f.db, func(ctx context.Context, tx queryExecutor) error {
		stmt := buildStatement(createFlowDefinitionStmt,
			entity.ProjectID,
			entity.ID,
			entity.Name,
			entity.SchemaVersion,
			entity.Status.String(),
			purposes,
			definition,
		).statement()
		if err := tx.Write(ctx, stmt, scanFlowDefinitionTimestamps(entity)); err != nil {
			return wrapError(err)
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindFlowDefinition, entity.ProjectID, entity.ID))
	})
}

func (f flowDefinitionStatements) GetFlowDefinitionByID(ctx context.Context, projectID, id string) (*domain.FlowDefinition, error) {
	row, err := f.db.ReadRow(ctx, flowDefinitionsTable, spanner.Key{projectID, id}, flowDefinitionColumns)
	if err != nil {
		return nil, err
	}
	return f.scanFlowDefinition(row)
}

func (f flowDefinitionStatements) UpdateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error {
	content, err := flowdefinition.Marshal(entity)
	if err != nil {
		return err
	}
	definition, err := encodeNullJSON(content)
	if err != nil {
		return wrapError(err)
	}
	purposes := flowdefinition.PurposeStrings(entity)
	stmt := buildStatement(updateFlowDefinitionStmt,
		entity.Name,
		entity.SchemaVersion,
		entity.Status.String(),
		purposes,
		definition,
		entity.ProjectID,
		entity.ID,
	).statement()
	return wrapError(f.db.Write(ctx, stmt, scanFlowDefinitionTimestamps(entity)))
}

func scanFlowDefinitionTimestamps(entity *domain.FlowDefinition) func(*spanner.RowIterator) error {
	return func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&entity.CreatedAt, &entity.UpdatedAt)
		})
		return err
	}
}

func (f flowDefinitionStatements) ListFlowDefinitions(ctx context.Context, filter *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
	opts := flowdefinition.EnsureListOptions(filter)

	var compiler statementCompiler
	err := compileList(ctx, &compiler, flowDefinitionQuery, opts, flowdefinition.Schema, "flow_definitions", "id")
	if err != nil {
		return nil, err
	}

	var defs []*domain.FlowDefinition
	err = f.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		defs, err = collectRows(iter, f.scanFlowDefinition)
		return err
	})
	if err != nil {
		return nil, err
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

func (f flowDefinitionStatements) DeleteFlowDefinitionByID(ctx context.Context, projectID, id string) error {
	return withTransaction(ctx, f.db, func(ctx context.Context, tx queryExecutor) error {
		n, err := tx.Update(ctx, buildStatement(deleteFlowDefinitionStmt, projectID, id).statement())
		if err != nil {
			return wrapError(err)
		}
		if n == 0 {
			return nil
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.DeleteResourceScope(ctx, domain.ResourceKindFlowDefinition, projectID, id)
	})
}

func (f flowDefinitionStatements) scanFlowDefinition(row *spanner.Row) (*domain.FlowDefinition, error) {
	var (
		projectID, id, name, schemaVersion string
		statusStr                          string
		definitionJSON                     spanner.NullJSON
		createdAt, updatedAt               time.Time
	)
	if err := row.Columns(&projectID, &id, &name, &schemaVersion, &statusStr, &definitionJSON, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	status, err := domain.FlowDefinitionStatusString(statusStr)
	if err != nil {
		return nil, wrapError(err)
	}
	raw, err := decodeNullJSON(definitionJSON)
	if err != nil {
		return nil, wrapError(err)
	}
	return flowdefinition.ToDomain(projectID, id, name, schemaVersion, status, createdAt, updatedAt, raw)
}

var _ service.FlowDefinitionStatements = (*flowDefinitionStatements)(nil)
