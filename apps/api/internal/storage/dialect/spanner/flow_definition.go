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
		`(project_id, id, name, schema_version, purposes, definition, created_at, updated_at) ` +
		`VALUES (@p1, @p2, @p3, @p4, @p5, @p6, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()) THEN RETURN created_at, updated_at`

	deleteFlowDefinitionStmt = `DELETE FROM flow_definitions WHERE project_id = @p1 AND id = @p2 THEN RETURN name`

	// newestFlowDefinitionByNameStmt is one descent of the name revision index.
	newestFlowDefinitionByNameStmt = flowDefinitionQuery + ` WHERE project_id = @p1 AND name = @p2 ORDER BY created_at DESC LIMIT 1`

	flowDefinitionQuery = `SELECT project_id, id, name, schema_version, definition, created_at, updated_at ` +
		`FROM flow_definitions`

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

var flowDefinitionColumns = []string{
	"project_id", "id", "name", "schema_version", "definition", "created_at", "updated_at",
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
			purposes,
			definition,
		).statement()
		if err := tx.Write(ctx, stmt, scanFlowDefinitionTimestamps(entity)); err != nil {
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

func (f flowDefinitionStatements) GetFlowDefinitionByID(ctx context.Context, projectID, id string) (*domain.FlowDefinition, error) {
	row, err := f.db.ReadRow(ctx, flowDefinitionsTable, spanner.Key{projectID, id}, flowDefinitionColumns)
	if err != nil {
		return nil, err
	}
	return f.scanFlowDefinition(row)
}

func scanFlowDefinitionTimestamps(entity *domain.FlowDefinition) func(*spanner.RowIterator) error {
	return func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&entity.CreatedAt, &entity.UpdatedAt)
		})
		return err
	}
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
		err := compileList(ctx, &compiler, flowDefinitionQuery, opts, flowdefinition.Schema, "flow_definitions", "id", conjuncts...)
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

func (f flowDefinitionStatements) DeleteFlowDefinitionByID(ctx context.Context, projectID, id string) error {
	return withTransaction(ctx, f.db, func(ctx context.Context, tx queryExecutor) error {
		var names []string
		if err := tx.Write(ctx, buildStatement(deleteFlowDefinitionStmt, projectID, id).statement(), func(iter *spanner.RowIterator) error {
			var err error
			names, err = collectRows(iter, func(row *spanner.Row) (string, error) {
				var name string
				return name, row.Columns(&name)
			})
			return err
		}); err != nil {
			return wrapError(err)
		}
		if len(names) == 0 {
			return nil
		}
		rsi := newResourceScopeStatements(tx)
		if err := rsi.DeleteResourceScope(ctx, domain.ResourceKindFlowDefinition, projectID, id); err != nil {
			return err
		}
		return f.replaceSearchEntry(ctx, tx, projectID, names[0])
	})
}

// replaceSearchEntry points the search entry of a flow name at its newest
// revision left, or removes it when none is.
func (f flowDefinitionStatements) replaceSearchEntry(ctx context.Context, tx queryExecutor, projectID, name string) error {
	var newest []*domain.FlowDefinition
	if err := tx.Query(ctx, buildStatement(newestFlowDefinitionByNameStmt, projectID, name).statement(), func(iter *spanner.RowIterator) error {
		var err error
		newest, err = collectRows(iter, f.scanFlowDefinition)
		return err
	}); err != nil {
		return err
	}
	if len(newest) == 0 {
		return deleteSearchEntry(ctx, tx, projectID, domain.ResourceKindFlowDefinition, name)
	}
	return writeSearchEntry(ctx, tx, domain.FlowDefinitionSearchEntry(newest[0]))
}

func (f flowDefinitionStatements) scanFlowDefinition(row *spanner.Row) (*domain.FlowDefinition, error) {
	var (
		projectID, id, name, schemaVersion string
		definitionJSON                     spanner.NullJSON
		createdAt, updatedAt               time.Time
	)
	if err := row.Columns(&projectID, &id, &name, &schemaVersion, &definitionJSON, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	raw, err := decodeNullJSON(definitionJSON)
	if err != nil {
		return nil, wrapError(err)
	}
	return flowdefinition.ToDomain(projectID, id, name, schemaVersion, createdAt, updatedAt, raw)
}

var _ service.FlowDefinitionStatements = (*flowDefinitionStatements)(nil)
