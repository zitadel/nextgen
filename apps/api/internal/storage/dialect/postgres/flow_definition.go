package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/flowdefinition"
)

const (
	purposeArrCast = "::zitadel_nextgen.flow_definition_purposes[]"

	createFlowDefinitionStmt = `INSERT INTO zitadel_nextgen.flow_definitions ` +
		`(project_id, id, name, schema_version, purposes, definition, created_at, updated_at) ` +
		`VALUES ($1, $2, $3, $4, $5` + purposeArrCast + `, $6, NOW(), NOW()) RETURNING created_at, updated_at`

	deleteFlowDefinitionStmt = `DELETE FROM zitadel_nextgen.flow_definitions WHERE project_id = $1 AND id = $2 RETURNING name`

	flowDefinitionQuery = `SELECT project_id, id, name, schema_version, definition, created_at, updated_at ` +
		`FROM zitadel_nextgen.flow_definitions`

	// newestFlowDefinitionByNameStmt is one descent of
	// idx_flow_definitions_name_revision.
	newestFlowDefinitionByNameStmt = flowDefinitionQuery + ` WHERE project_id = $1 AND name = $2 ORDER BY created_at DESC LIMIT 1`

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
	latestRevisionPerName = `NOT EXISTS (SELECT 1 FROM zitadel_nextgen.flow_definitions newer` +
		` WHERE newer.project_id = zitadel_nextgen.flow_definitions.project_id` +
		` AND newer.name = zitadel_nextgen.flow_definitions.name` +
		` AND newer.created_at > zitadel_nextgen.flow_definitions.created_at)`
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
		if err := tx.QueryRow(ctx, createFlowDefinitionStmt,
			entity.ProjectID,
			entity.ID,
			entity.Name,
			entity.SchemaVersion,
			purposes,
			content,
		).Scan(&entity.CreatedAt, &entity.UpdatedAt); err != nil {
			return wrapError(err)
		}
		entity.CreatedAt, entity.UpdatedAt = entity.CreatedAt.UTC(), entity.UpdatedAt.UTC()
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
	def, err := pgx.CollectExactlyOneRow(rows, f.scanFlowDefinition)
	if err != nil {
		return nil, wrapError(err)
	}
	return def, nil
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
		err := compileList(ctx, &compiler, flowDefinitionQuery, opts, flowdefinition.Schema, "zitadel_nextgen.flow_definitions", "id", conjuncts...)
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

		return defs, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.FlowDefinition]{
		Items:      defs,
		NextCursor: nextCursor,
	}, nil
}

// DeleteFlowDefinitionByID implements [service.FlowDefinitionStatements].
func (f flowDefinitionStatements) DeleteFlowDefinitionByID(ctx context.Context, projectID, id string) error {
	return withTransaction(ctx, f.client, func(ctx context.Context, tx queryExecutor) error {
		var name string
		if err := tx.QueryRow(ctx, deleteFlowDefinitionStmt, projectID, id).Scan(&name); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
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
	newest, err := pgx.CollectRows(rows, f.scanFlowDefinition)
	if err != nil {
		return wrapError(err)
	}
	if len(newest) == 0 {
		return deleteSearchEntry(ctx, tx, projectID, domain.ResourceKindFlowDefinition, name)
	}
	return writeSearchEntry(ctx, tx, domain.FlowDefinitionSearchEntry(newest[0]))
}

func (f flowDefinitionStatements) scanFlowDefinition(row pgx.CollectableRow) (*domain.FlowDefinition, error) {
	var (
		projectID, id, name, schemaVersion string
		definition                         []byte
		createdAt, updatedAt               time.Time
	)
	if err := row.Scan(&projectID, &id, &name, &schemaVersion, &definition, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return flowdefinition.ToDomain(projectID, id, name, schemaVersion, createdAt, updatedAt, definition)
}

var _ service.FlowDefinitionStatements = (*flowDefinitionStatements)(nil)
