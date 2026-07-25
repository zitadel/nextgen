package spanner

import (
	"context"
	"encoding/json"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/v2/flowdefinition"
)

const (
	flowDefinitionsTable = "flow_definitions"

	createFlowDefinitionStmt = `INSERT INTO flow_definitions ` +
		`(project_id, id, name, schema_version, status, purposes, definition, created_at, updated_at) ` +
		`VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`

	deleteFlowDefinitionStmt = `DELETE FROM flow_definitions WHERE project_id = @p1 AND id = @p2`

	updateFlowDefinitionStmt = `UPDATE flow_definitions SET ` +
		`name = @p1, schema_version = @p2, status = @p3, purposes = @p4, ` +
		`definition = @p5, updated_at = CURRENT_TIMESTAMP() WHERE project_id = @p6 AND id = @p7`

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
	content, err := flowdefinition.Marshal(entity)
	if err != nil {
		return err
	}
	definition, err := encodeFlowDefinitionJSON(content)
	if err != nil {
		return wrapError(err)
	}
	purposes := flowdefinition.PurposeStrings(entity)
	stmt := buildStatement(createFlowDefinitionStmt,
		entity.ProjectID,
		entity.ID,
		entity.Name,
		entity.SchemaVersion,
		entity.Status.String(),
		purposes,
		definition,
	).statement()
	_, err = f.db.Update(ctx, stmt)
	return wrapError(err)
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
	definition, err := encodeFlowDefinitionJSON(content)
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
	_, err = f.db.Update(ctx, stmt)
	return wrapError(err)
}

func (f flowDefinitionStatements) ListFlowDefinitions(ctx context.Context, filter *database.ListOptions[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
	if filter == nil {
		filter = &database.ListOptions[domain.FlowDefinitionField]{}
	}
	opts := *filter
	if len(opts.Pagination.OrderBy.Columns) == 0 {
		opts.Pagination.OrderBy = database.OrderBy[domain.FlowDefinitionField]{
			Columns: []database.Column[domain.FlowDefinitionField]{
				database.Col(domain.FlowDefinitionFieldCreatedAt),
				database.Col(domain.FlowDefinitionFieldID),
			},
			Direction: database.OrderDesc,
		}
	}

	purposeValue, remaining := flowdefinition.ExtractPurposeContains(opts.Filter)
	opts.Filter = remaining

	var compiler statementCompiler
	err := compileRead(&compiler, flowDefinitionQuery, &opts, flowdefinition.Schema,
		func(c *statementCompiler, hasWhere bool) bool {
			if purposeValue == "" {
				return hasWhere
			}
			if hasWhere {
				c.WriteString(" AND ")
			} else {
				c.WriteString(" WHERE ")
			}
			writeArg(c, purposeValue)
			c.WriteString(" IN UNNEST(purposes)")
			return true
		},
	)
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

	var nextCursor []byte
	if opts.Pagination.Limit > 0 && len(defs) == int(opts.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.FlowDefinitionField]{
			Columns: opts.Pagination.OrderBy.Columns,
			Values:  flowdefinition.Schema.ValuesFrom(defs[len(defs)-1], opts.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.FlowDefinition]{
		Items:      defs,
		NextCursor: nextCursor,
	}, nil
}

func (f flowDefinitionStatements) DeleteFlowDefinitionByID(ctx context.Context, projectID, id string) error {
	stmt := buildStatement(deleteFlowDefinitionStmt, projectID, id).statement()
	_, err := f.db.Update(ctx, stmt)
	return wrapError(err)
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
	raw, err := decodeFlowDefinitionJSON(definitionJSON)
	if err != nil {
		return nil, wrapError(err)
	}
	return flowdefinition.ToDomain(projectID, id, name, schemaVersion, status, createdAt, updatedAt, raw)
}

func encodeFlowDefinitionJSON(b []byte) (spanner.NullJSON, error) {
	if len(b) == 0 {
		return spanner.NullJSON{Valid: false}, nil
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return spanner.NullJSON{}, err
	}
	return spanner.NullJSON{Value: v, Valid: true}, nil
}

func decodeFlowDefinitionJSON(v spanner.NullJSON) ([]byte, error) {
	if !v.Valid {
		return nil, nil
	}
	return json.Marshal(v.Value)
}

var _ service.FlowDefinitionStatements = (*flowDefinitionStatements)(nil)
