package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/flowdefinition"
)

const (
	createFlowDefinitionStmt = `INSERT INTO flow_definitions
(project_id, id, name, schema_version, status, purposes, definition, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

	deleteFlowDefinitionStmt = `DELETE FROM flow_definitions WHERE project_id = ? AND id = ?`

	updateFlowDefinitionStmt = `UPDATE flow_definitions SET
name = ?, schema_version = ?, status = ?, purposes = ?, definition = ?, updated_at = ?
WHERE project_id = ? AND id = ?`

	flowDefinitionQuery = `SELECT project_id, id, name, schema_version, status, definition, created_at, updated_at
FROM flow_definitions`
)

type flowDefinitionStatements struct{ statement }

func newFlowDefinitionStatements(client queryExecutor) flowDefinitionStatements {
	return flowDefinitionStatements{statement: statement{client: client}}
}

// CreateFlowDefinition implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) CreateFlowDefinition(ctx context.Context, entity *domain.FlowDefinition) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixFlowDefinition); err != nil {
		return err
	}
	content, err := flowdefinition.Marshal(entity)
	if err != nil {
		return err
	}
	var defStr sql.NullString
	if len(content) > 0 {
		defStr = sql.NullString{String: string(content), Valid: true}
	}
	purposes, err := encodeJSON(flowdefinition.PurposeStrings(entity))
	if err != nil {
		return wrapError(err)
	}
	now := nowUnixNano()
	return withTransaction(ctx, f.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, createFlowDefinitionStmt,
			entity.ProjectID, entity.ID, entity.Name, entity.SchemaVersion,
			entity.Status.String(), purposes, defStr, now, now,
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
	defer rows.Close()
	def, err := collectExactlyOneRow(rows, f.scanFlowDefinition)
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
	var defStr sql.NullString
	if len(content) > 0 {
		defStr = sql.NullString{String: string(content), Valid: true}
	}
	purposes, err := encodeJSON(flowdefinition.PurposeStrings(entity))
	if err != nil {
		return wrapError(err)
	}
	now := nowUnixNano()
	_, err = f.client.Exec(ctx, updateFlowDefinitionStmt,
		entity.Name, entity.SchemaVersion, entity.Status.String(), purposes, defStr, now,
		entity.ProjectID, entity.ID,
	)
	return wrapError(err)
}

// ListFlowDefinitions implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) ListFlowDefinitions(ctx context.Context, filter *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
	opts := flowdefinition.EnsureListOptions(filter)

	var compiler statementCompiler
	if err := compileRead(&compiler, flowDefinitionQuery, opts, flowdefinition.Schema); err != nil {
		return nil, err
	}
	rows, err := f.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	defs, err := collectRows(rows, f.scanFlowDefinition)
	if err != nil {
		return nil, wrapError(err)
	}
	nextCursor := pagination.MarshalNext(
		opts.Pagination.OrderBy,
		defs,
		flowdefinition.Schema,
		opts.Pagination.Limit,
	)
	return &database.ListResult[*domain.FlowDefinition]{Items: defs, NextCursor: nextCursor}, nil
}

// DeleteFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) DeleteFlowDefinitionByID(ctx context.Context, projectID, id string) error {
	return withTransaction(ctx, f.client, func(ctx context.Context, tx queryExecutor) error {
		n, err := execAffected(ctx, tx, deleteFlowDefinitionStmt, projectID, id)
		if err != nil {
			return err
		}
		if n == 0 {
			return nil
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.DeleteResourceScope(ctx, id)
	})
}

func (f flowDefinitionStatements) scanFlowDefinition(rows *sql.Rows) (*domain.FlowDefinition, error) {
	var (
		projectID, id, name, schemaVersion, statusStr string
		definitionStr                                 sql.NullString
		createdNano, updatedNano                      int64
	)
	if err := rows.Scan(&projectID, &id, &name, &schemaVersion, &statusStr, &definitionStr, &createdNano, &updatedNano); err != nil {
		return nil, err
	}
	status, err := domain.FlowDefinitionStatusString(statusStr)
	if err != nil {
		return nil, wrapError(err)
	}
	var raw []byte
	if definitionStr.Valid && definitionStr.String != "" {
		raw = []byte(definitionStr.String)
	}
	createdAt := timeFromUnixNano(createdNano)
	updatedAt := timeFromUnixNano(updatedNano)
	return flowdefinition.ToDomain(projectID, id, name, schemaVersion, status, createdAt, updatedAt, raw)
}

var _ service.FlowDefinitionStatements = (*flowDefinitionStatements)(nil)
