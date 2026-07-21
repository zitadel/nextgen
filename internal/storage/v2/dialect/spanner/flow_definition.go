package spanner

import (
	"context"
	"encoding/json"
	"strconv"
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

	purposeValue, remaining := extractPurposeContains(opts.Filter)
	opts.Filter = remaining

	var compiler statementCompiler
	if err := compileFlowDefinitionList(&compiler, &opts, purposeValue); err != nil {
		return nil, err
	}

	var defs []*domain.FlowDefinition
	err := f.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
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
			Values:  flowDefinitionSchema.ValuesFrom(defs[len(defs)-1], opts.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}

	return &database.ListResult[*domain.FlowDefinition]{
		Items:      defs,
		NextCursor: nextCursor,
	}, nil
}

func compileFlowDefinitionList(c *statementCompiler, opt *database.ListOptions[domain.FlowDefinitionField], purposeValue string) error {
	c.WriteString(flowDefinitionQuery)

	filter := opt.Filter
	if len(opt.Pagination.Cursor) != 0 {
		cursor, err := pagination.CursorFromToken[domain.FlowDefinitionField](opt.Pagination.Cursor)
		if err != nil {
			return database.ErrInvalidCursor()
		}
		if !cursor.MatchesOrderBy(opt.Pagination.OrderBy.Columns) {
			return database.ErrCursorOrderMismatch()
		}
		values, err := flowDefinitionSchema.CoerceCursorValues(cursor.Columns, cursor.Values)
		if err != nil {
			return database.ErrInvalidCursor().WithParent(err)
		}
		terms := compareTerms(cursor.Columns, values)
		if opt.Pagination.OrderBy.Direction == database.OrderAsc {
			filter = database.And(filter, database.CompareGreater(terms...))
		} else {
			filter = database.And(filter, database.CompareLess(terms...))
		}
	}

	if filter != nil || purposeValue != "" {
		c.WriteString(" WHERE ")
		if filter != nil {
			compileFilter(c, filter, flowDefinitionSchema)
			if purposeValue != "" {
				c.WriteString(" AND ")
			}
		}
		if purposeValue != "" {
			writeArg(c, purposeValue)
			c.WriteString(" IN UNNEST(purposes)")
		}
	}

	compileOrderBy(c, opt.Pagination.OrderBy, flowDefinitionSchema)
	compileLimit(c, opt.Pagination.Limit)
	return nil
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
		return spanner.NullJSON{Value: string(b), Valid: true}, nil
	}
	return spanner.NullJSON{Value: v, Valid: true}, nil
}

func decodeFlowDefinitionJSON(v spanner.NullJSON) ([]byte, error) {
	if !v.Valid {
		return nil, nil
	}
	return json.Marshal(v.Value)
}

func extractPurposeContains(filter database.Filter[domain.FlowDefinitionField]) (purpose string, remaining database.Filter[domain.FlowDefinitionField]) {
	if filter == nil {
		return "", nil
	}
	switch f := filter.(type) {
	case database.AndFilter[domain.FlowDefinitionField]:
		kept := make([]database.Filter[domain.FlowDefinitionField], 0, len(f.Filters))
		for _, child := range f.Filters {
			p, rest := extractPurposeContains(child)
			if p != "" {
				purpose = p
			}
			if rest != nil {
				kept = append(kept, rest)
			}
		}
		if len(kept) == 0 {
			return purpose, nil
		}
		if len(kept) == 1 {
			return purpose, kept[0]
		}
		return purpose, database.And(kept...)
	case *database.CompareFilter[domain.FlowDefinitionField]:
		if f.Op == database.OpEqual && len(f.Terms) == 1 && f.Terms[0].Column.Field() == domain.FlowDefinitionFieldPurposes {
			return purposeFilterValue(f.Terms[0].Value), nil
		}
		return "", f
	default:
		return "", filter
	}
}

func purposeFilterValue(v any) string {
	switch p := v.(type) {
	case string:
		return p
	case domain.FlowDefinitionPurpose:
		return p.String()
	case *domain.FlowDefinitionPurpose:
		if p == nil {
			return ""
		}
		return p.String()
	default:
		return ""
	}
}

func (f flowDefinitionStatements) IsStatements() {}

var _ service.FlowDefinitionStatements = (*flowDefinitionStatements)(nil)

func parseFlowDefinitionPurposeKey(s string) (domain.FlowDefinitionPurpose, error) {
	if purpose, err := domain.FlowDefinitionPurposeString(s); err == nil {
		return purpose, nil
	}
	n, err := strconv.ParseUint(s, 10, 8)
	if err != nil {
		return 0, database.ErrInvalidEnumKey(s)
	}
	return domain.FlowDefinitionPurpose(n), nil
}

var flowDefinitionSchema = database.NewSchema(map[domain.FlowDefinitionField]database.FieldBinding[domain.FlowDefinition]{
	domain.FlowDefinitionFieldProjectID: {
		SQLName:  "project_id",
		Accessor: func(d *domain.FlowDefinition) any { return d.ProjectID },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldID: {
		SQLName:  "id",
		Accessor: func(d *domain.FlowDefinition) any { return d.ID },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldName: {
		SQLName:  "name",
		Accessor: func(d *domain.FlowDefinition) any { return d.Name },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldSchemaVersion: {
		SQLName:  "schema_version",
		Accessor: func(d *domain.FlowDefinition) any { return d.SchemaVersion },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldStatus: {
		SQLName:  "status",
		Accessor: func(d *domain.FlowDefinition) any { return d.Status },
		Coerce:   database.CoerceNumber[domain.FlowDefinitionStatus],
	},
	domain.FlowDefinitionFieldCreatedAt: {
		SQLName:  "created_at",
		Accessor: func(d *domain.FlowDefinition) any { return d.CreatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.FlowDefinitionFieldUpdatedAt: {
		SQLName:  "updated_at",
		Accessor: func(d *domain.FlowDefinition) any { return d.UpdatedAt },
		Coerce:   database.CoerceTime,
	},
	domain.FlowDefinitionFieldUserSchema: {
		SQLName:  "user_schema",
		Accessor: func(d *domain.FlowDefinition) any { return d.UserSchema },
		Coerce:   database.CoerceString,
	},
	domain.FlowDefinitionFieldPurposes: {
		SQLName:  "purposes",
		Accessor: func(d *domain.FlowDefinition) any { return d.Purposes },
		Coerce:   database.CoerceEnumKeyMapAsAny[domain.FlowDefinitionPurpose, string](parseFlowDefinitionPurposeKey),
	},
	domain.FlowDefinitionFieldAudience: {
		SQLName:  "audience",
		Accessor: func(d *domain.FlowDefinition) any { return d.Audience },
		Coerce:   database.CoerceJSON[domain.FlowDefinitionAudience],
	},
	domain.FlowDefinitionFieldSteps: {
		SQLName:  "steps",
		Accessor: func(d *domain.FlowDefinition) any { return d.Steps },
		Coerce:   database.CoerceSliceAsAny(database.CoerceJSONValue[domain.FlowDefinitionStep]),
	},
})
