package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/flowdefinition"
)

const (
	createFlowDefinitionStmt = `INSERT INTO flow_definitions
(project_id, id, name, schema_version, purposes, definition, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING created_at, updated_at`

	deleteFlowDefinitionStmt = `DELETE FROM flow_definitions WHERE project_id = ? AND id = ? RETURNING name`

	flowDefinitionQuery = `SELECT project_id, id, name, schema_version, definition, created_at, updated_at
FROM flow_definitions`

	// newestFlowDefinitionByNameStmt is one descent of the name revision index.
	newestFlowDefinitionByNameStmt = flowDefinitionQuery + ` WHERE project_id = ? AND name = ? ORDER BY created_at DESC LIMIT 1`

	// latestRevisionPerName keeps only the newest revision of each flow name.
	//
	// The uniqueness of (project_id, name, created_at) makes created_at a
	// total order within a name, so no tiebreak belongs in here.
	//
	// The sub-query deliberately carries no authz predicate, so "newest" is
	// the newest revision that exists rather than the newest the caller may
	// read: a caller granted only a superseded revision sees it under
	// revisions=all and sees nothing for that flow under revisions=latest.
	// Which revision is current is a property of the flow, not of the reader.
	latestRevisionPerName = `NOT EXISTS (SELECT 1 FROM flow_definitions AS newer` +
		` WHERE newer.project_id = flow_definitions.project_id` +
		` AND newer.name = flow_definitions.name` +
		` AND newer.created_at > flow_definitions.created_at)`
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
		if err := scanFlowDefinitionTimestamps(entity, tx.QueryRow(ctx, createFlowDefinitionStmt,
			entity.ProjectID, entity.ID, entity.Name, entity.SchemaVersion,
			purposes, defStr, now, now,
		)); err != nil {
			return err
		}
		rsi := newResourceScopeStatements(tx)
		if err := rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindFlowDefinition, entity.ProjectID, entity.ID)); err != nil {
			return err
		}
		// The new revision is the newest of its name, so search answers with it.
		return writeSearchEntry(ctx, tx, domain.FlowDefinitionSearchEntry(entity))
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

func scanFlowDefinitionTimestamps(entity *domain.FlowDefinition, row *sql.Row) error {
	var createdNano, updatedNano int64
	if err := row.Scan(&createdNano, &updatedNano); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = timeFromUnixNano(createdNano)
	entity.UpdatedAt = timeFromUnixNano(updatedNano)
	return nil
}

// ListFlowDefinitions implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) ListFlowDefinitions(ctx context.Context, filter *database.ListOptions[domain.FlowDefinitionField], queryOpts service.FlowDefinitionQueryOptions) (*database.ListResult[*domain.FlowDefinition], error) {
	opts := flowdefinition.EnsureListOptions(filter)
	defs, nextCursor, err := pagination.Page(opts.Pagination, flowdefinition.Schema, func(limit uint32) ([]*domain.FlowDefinition, error) {
		opts := opts.WithLimit(limit)

		var conjuncts []string
		if queryOpts.LatestRevisionPerName {
			conjuncts = append(conjuncts, latestRevisionPerName)
		}

		var compiler statementCompiler
		if err := compileList(ctx, &compiler, flowDefinitionQuery, opts, flowdefinition.Schema, "flow_definitions", "id", conjuncts...); err != nil {
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
		return defs, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.FlowDefinition]{Items: defs, NextCursor: nextCursor}, nil
}

// DeleteFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) DeleteFlowDefinitionByID(ctx context.Context, projectID, id string) error {
	return withTransaction(ctx, f.client, func(ctx context.Context, tx queryExecutor) error {
		var name string
		if err := tx.QueryRow(ctx, deleteFlowDefinitionStmt, projectID, id).Scan(&name); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return wrapError(err)
		}
		rsi := newResourceScopeStatements(tx)
		if err := rsi.DeleteResourceScope(ctx, domain.ResourceKindFlowDefinition, projectID, id); err != nil {
			return err
		}
		return f.replaceSearchEntry(ctx, tx, projectID, name)
	})
}

// replaceSearchEntry points the search entry of a flow name at its newest
// revision left, or removes it when none is.
func (f flowDefinitionStatements) replaceSearchEntry(ctx context.Context, tx queryExecutor, projectID, name string) error {
	rows, err := tx.Query(ctx, newestFlowDefinitionByNameStmt, projectID, name)
	if err != nil {
		return wrapError(err)
	}
	defer rows.Close()
	newest, err := collectRows(rows, f.scanFlowDefinition)
	if err != nil {
		return wrapError(err)
	}
	if len(newest) == 0 {
		return deleteSearchEntry(ctx, tx, projectID, domain.ResourceKindFlowDefinition, name)
	}
	return writeSearchEntry(ctx, tx, domain.FlowDefinitionSearchEntry(newest[0]))
}

func (f flowDefinitionStatements) scanFlowDefinition(rows *sql.Rows) (*domain.FlowDefinition, error) {
	var (
		projectID, id, name, schemaVersion string
		definitionStr                      sql.NullString
		createdNano, updatedNano           int64
	)
	if err := rows.Scan(&projectID, &id, &name, &schemaVersion, &definitionStr, &createdNano, &updatedNano); err != nil {
		return nil, err
	}
	var raw []byte
	if definitionStr.Valid && definitionStr.String != "" {
		raw = []byte(definitionStr.String)
	}
	createdAt := timeFromUnixNano(createdNano)
	updatedAt := timeFromUnixNano(updatedNano)
	return flowdefinition.ToDomain(projectID, id, name, schemaVersion, createdAt, updatedAt, raw)
}

var _ service.FlowDefinitionStatements = (*flowDefinitionStatements)(nil)
